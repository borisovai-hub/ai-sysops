const express = require('express');
const bodyParser = require('body-parser');
const session = require('express-session');
const fs = require('fs-extra');
const path = require('path');
const axios = require('axios');
const yaml = require('yaml');
const { execSync } = require('child_process');

const app = express();
const PORT = 3000;
const CONFIG_FILE = '/etc/management-ui/config.json';
const AUTH_FILE = '/etc/management-ui/auth.json';
const TRAEFIK_DYNAMIC_DIR = '/etc/traefik/dynamic';
const DNS_CONFIG_FILE = '/etc/dns-api/config.json';
const PROJECTS_FILE = '/etc/management-ui/projects.json';
const TEMPLATES_DIR = path.join(__dirname, 'templates');

// Настройка сессий
app.use(session({
    secret: 'management-ui-secret-key-change-in-production',
    resave: false,
    saveUninitialized: false,
    cookie: {
        httpOnly: true,
        secure: false, // Установить true если используется HTTPS
        maxAge: 24 * 60 * 60 * 1000 // 24 часа
    }
}));

// Middleware
app.use(bodyParser.json());
app.use(bodyParser.urlencoded({ extended: true }));
// Загрузка конфигурации
let config = {};
try {
    if (fs.existsSync(CONFIG_FILE)) {
        config = fs.readJsonSync(CONFIG_FILE);
    }
} catch (error) {
    console.error('Ошибка загрузки конфигурации:', error.message);
}

// Загрузка конфигурации авторизации
let authConfig = {};
try {
    if (fs.existsSync(AUTH_FILE)) {
        authConfig = fs.readJsonSync(AUTH_FILE);
    } else {
        // Файл авторизации должен быть создан скриптом установки
        console.error('Ошибка: Файл авторизации не найден:', AUTH_FILE);
        console.error('Запустите скрипт установки для создания файла авторизации с безопасным паролем');
        console.error('Или создайте файл вручную:');
        console.error('  sudo mkdir -p /etc/management-ui');
        console.error('  sudo nano /etc/management-ui/auth.json');
        console.error('  {');
        console.error('    "username": "admin",');
        console.error('    "password": "ваш_безопасный_пароль"');
        console.error('  }');
        console.error('  sudo chmod 600 /etc/management-ui/auth.json');
    }
} catch (error) {
    console.error('Ошибка загрузки конфигурации авторизации:', error.message);
}

// Удаление \r и других непечатаемых символов из строк (записи в UI не должны содержать их)
function sanitizeString(str) {
    if (str == null || typeof str !== 'string') return '';
    return str.replace(/\r/g, '').replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g, '').trim();
}

// Имя сервиса допустимо для имени файла (без path traversal)
function isSafeServiceName(name) {
    if (!name || typeof name !== 'string') return false;
    return /^[a-zA-Z0-9._-]+$/.test(name) && !name.includes('..');
}

// Построить правило Host из строки доменов (один или через запятую)
function buildHostRule(domainStr) {
    if (!domainStr || typeof domainStr !== 'string') return '';
    const parts = domainStr.split(',').map(s => sanitizeString(s)).filter(Boolean);
    if (parts.length === 0) return '';
    return parts.map(d => `Host(\`${d}\`)`).join(' || ');
}

// Middleware проверки авторизации
function requireAuth(req, res, next) {
    if (req.session && req.session.authenticated) {
        return next();
    }
    if (req.path.startsWith('/api/')) {
        return res.status(401).json({ error: 'Требуется авторизация' });
    }
    res.redirect('/login');
}

// Статические файлы с проверкой авторизации
// login доступен без авторизации, остальные страницы — только после входа
app.use((req, res, next) => {
    if (req.path === '/login' || req.path === '/login.html') {
        return next();
    }
    if (req.path.startsWith('/api/')) {
        return next();
    }
    requireAuth(req, res, next);
});
app.use(express.static(path.join(__dirname, 'public')));

// Загрузка DNS конфигурации
let dnsConfig = {};
try {
    if (fs.existsSync(DNS_CONFIG_FILE)) {
        dnsConfig = fs.readJsonSync(DNS_CONFIG_FILE);
    }
} catch (error) {
    console.warn('DNS конфигурация не найдена');
}

const DNS_API_PORT = dnsConfig.port || 5353;
const DNS_API_BASE = `http://127.0.0.1:${DNS_API_PORT}`;

// ==================== Helper functions ====================

async function getExternalIp() {
    try {
        const response = await axios.get('https://api.ipify.org?format=json', { timeout: 5000 });
        return response.data.ip;
    } catch (error) {
        return '127.0.0.1';
    }
}

async function createDnsRecord(subdomain, ip) {
    if (!dnsConfig.provider) return { done: false, detail: 'DNS провайдер не настроен' };
    try {
        execSync(`manage-dns create ${sanitizeString(subdomain)} ${sanitizeString(ip)}`, { stdio: 'pipe' });
        return { done: true, detail: `A запись создана: ${subdomain} → ${ip}` };
    } catch (error) {
        return { done: false, error: error.message };
    }
}

async function deleteDnsRecord(subdomain) {
    if (!dnsConfig.provider) return;
    try {
        execSync(`manage-dns delete ${sanitizeString(subdomain)}`, { stdio: 'pipe' });
    } catch (error) {
        console.warn('Ошибка удаления DNS записи:', error.message);
    }
}

async function createTraefikConfig(name, domain, internalIp, port) {
    const configContent = {
        http: {
            routers: {
                [name]: {
                    rule: `Host(\`${domain}\`)`,
                    service: name,
                    entryPoints: ['websecure'],
                    tls: { certResolver: 'letsencrypt' }
                }
            },
            services: {
                [name]: {
                    loadBalancer: {
                        servers: [{ url: `http://${internalIp}:${port}` }]
                    }
                }
            }
        }
    };
    const configPath = path.join(TRAEFIK_DYNAMIC_DIR, `${name}.yml`);
    await fs.writeFile(configPath, yaml.stringify(configContent));
    return { done: true, detail: `${name}.yml` };
}

async function deleteTraefikConfig(name) {
    const configPath = path.join(TRAEFIK_DYNAMIC_DIR, `${name}.yml`);
    if (await fs.pathExists(configPath)) {
        await fs.remove(configPath);
    }
}

function reloadTraefik() {
    try {
        execSync('systemctl reload traefik', { stdio: 'pipe' });
    } catch (error) {
        console.warn('Ошибка перезагрузки Traefik:', error.message);
    }
}

// GitLab API helper
async function gitlabApi(method, endpoint, data) {
    if (!config.gitlab_url || !config.gitlab_token) {
        throw new Error('GitLab URL или токен не настроены в config.json');
    }
    const url = `${config.gitlab_url}/api/v4${endpoint}`;
    const response = await axios({
        method,
        url,
        headers: { 'PRIVATE-TOKEN': config.gitlab_token },
        data,
        timeout: 15000
    });
    return response.data;
}

async function pushFileToGitlab(projectId, filePath, content, branch, commitMessage) {
    const encodedPath = encodeURIComponent(filePath);
    const payload = {
        branch,
        content,
        commit_message: commitMessage
    };
    try {
        // Check if file exists
        await gitlabApi('get', `/projects/${projectId}/repository/files/${encodedPath}?ref=${branch}`);
        // File exists, update it
        return await gitlabApi('put', `/projects/${projectId}/repository/files/${encodedPath}`, payload);
    } catch (error) {
        if (error.response && error.response.status === 404) {
            // File doesn't exist, create it
            return await gitlabApi('post', `/projects/${projectId}/repository/files/${encodedPath}`, payload);
        }
        throw error;
    }
}

async function setGitlabCiVariable(projectId, key, value, options = {}) {
    const payload = {
        key,
        value,
        variable_type: options.variable_type || 'env_var',
        protected: options.protected || false,
        masked: options.masked || false
    };
    try {
        // Try to create
        return await gitlabApi('post', `/projects/${projectId}/variables`, payload);
    } catch (error) {
        if (error.response && error.response.status === 400) {
            // Variable exists, update it
            return await gitlabApi('put', `/projects/${projectId}/variables/${key}`, payload);
        }
        throw error;
    }
}

// Strapi API helper
async function strapiApi(method, endpoint, data) {
    if (!config.strapi_url || !config.strapi_token) {
        throw new Error('Strapi URL или токен не настроены в config.json');
    }
    const response = await axios({
        method,
        url: `${config.strapi_url}/api${endpoint}`,
        headers: { Authorization: `Bearer ${config.strapi_token}` },
        data,
        timeout: 15000
    });
    return response.data;
}

async function createOrUpdateStrapiProject(slug, fields) {
    try {
        // Search by slug
        const existing = await strapiApi('get', `/projects?filters[slug][$eq]=${slug}`);
        if (existing.data && existing.data.length > 0) {
            const id = existing.data[0].id;
            await strapiApi('put', `/projects/${id}`, { data: fields });
            return { done: true, detail: `Strapi проект #${id} обновлён`, id };
        }
        // Create new
        const created = await strapiApi('post', '/projects', { data: { slug, ...fields } });
        return { done: true, detail: `Strapi проект #${created.data.id} создан`, id: created.data.id };
    } catch (error) {
        return { done: false, error: error.message };
    }
}

// Template and Registry helpers
function loadTemplate(templateName) {
    const templatePath = path.join(TEMPLATES_DIR, templateName);
    if (!fs.existsSync(templatePath)) {
        throw new Error(`Шаблон не найден: ${templateName}`);
    }
    return fs.readFileSync(templatePath, 'utf8');
}

function renderTemplate(template, vars) {
    let result = template;
    for (const [key, value] of Object.entries(vars)) {
        result = result.replace(new RegExp(`\\{\\{${key}\\}\\}`, 'g'), value);
    }
    return result;
}

function loadProjects() {
    try {
        if (fs.existsSync(PROJECTS_FILE)) {
            return fs.readJsonSync(PROJECTS_FILE);
        }
    } catch (error) {
        console.error('Ошибка чтения реестра проектов:', error.message);
    }
    return [];
}

function saveProjects(projects) {
    fs.writeJsonSync(PROJECTS_FILE, projects, { spaces: 2 });
}

function allocatePort(projects) {
    const basePort = config.base_port || 4010;
    const usedPorts = new Set();
    for (const p of projects) {
        if (p.ports) {
            if (p.ports.frontend) usedPorts.add(p.ports.frontend);
            if (p.ports.backend) usedPorts.add(p.ports.backend);
        }
    }
    let port = basePort;
    while (usedPorts.has(port)) port++;
    return port;
}

function getTemplateForProject(projectType, appType) {
    const mapping = {
        deploy: { frontend: 'frontend.gitlab-ci.yml', backend: 'backend.gitlab-ci.yml', fullstack: 'fullstack.gitlab-ci.yml' },
        docs: { default: 'docs.gitlab-ci.yml' },
        infra: { default: 'validate.gitlab-ci.yml' },
        product: { default: 'product.gitlab-ci.yml' }
    };
    const typeMap = mapping[projectType];
    if (!typeMap) throw new Error(`Неизвестный тип проекта: ${projectType}`);
    return typeMap[appType] || typeMap.default || Object.values(typeMap)[0];
}

// ==================== Routes ====================

// Проксирование запросов к локальному DNS API (страница dns.borisovai.ru / dns.html)
app.get('/api/dns/records', requireAuth, async (req, res) => {
    if (dnsConfig.provider !== 'local') {
        return res.json({ records: [], message: 'Список записей доступен только при использовании локального DNS API' });
    }
    try {
        const response = await axios.get(`${DNS_API_BASE}/api/records`, { timeout: 5000 });
        res.json(response.data);
    } catch (error) {
        console.error('Ошибка получения DNS записей:', error.message);
        res.status(500).json({ error: error.message, records: [] });
    }
});

app.post('/api/dns/records', requireAuth, async (req, res) => {
    if (dnsConfig.provider !== 'local') {
        return res.status(400).json({ error: 'Добавление записей через интерфейс доступно только при локальном DNS API' });
    }
    const domain = dnsConfig.domain;
    if (!domain) {
        return res.status(400).json({ error: 'В /etc/dns-api/config.json не указан domain' });
    }
    try {
        const body = { ...req.body, domain };
        const response = await axios.post(`${DNS_API_BASE}/api/records`, body, { timeout: 5000 });
        res.status(response.status).json(response.data);
    } catch (error) {
        const msg = error.response?.data?.error || error.message;
        res.status(error.response?.status || 500).json({ error: msg });
    }
});

app.put('/api/dns/records/:id', requireAuth, async (req, res) => {
    if (dnsConfig.provider !== 'local') {
        return res.status(400).json({ error: 'Редактирование доступно только при локальном DNS API' });
    }
    try {
        const response = await axios.put(`${DNS_API_BASE}/api/records/${req.params.id}`, req.body, { timeout: 5000 });
        res.json(response.data);
    } catch (error) {
        const msg = error.response?.data?.error || error.message;
        res.status(error.response?.status || 500).json({ error: msg });
    }
});

app.delete('/api/dns/records/:id', requireAuth, async (req, res) => {
    if (dnsConfig.provider !== 'local') {
        return res.status(400).json({ error: 'Удаление доступно только при локальном DNS API' });
    }
    try {
        const response = await axios.delete(`${DNS_API_BASE}/api/records/${req.params.id}`, { timeout: 5000 });
        res.json(response.data);
    } catch (error) {
        const msg = error.response?.data?.error || error.message;
        res.status(error.response?.status || 500).json({ error: msg });
    }
});

// Страница DNS
app.get('/dns.html', requireAuth, (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'dns.html'));
});

// Страница входа (не требует авторизации)
app.get('/login', (req, res) => {
    if (req.session && req.session.authenticated) {
        return res.redirect('/');
    }
    res.sendFile(path.join(__dirname, 'public', 'login.html'));
});

// Обработка входа
app.post('/login', (req, res) => {
    const { username, password } = req.body;

    if (username === authConfig.username && password === authConfig.password) {
        req.session.authenticated = true;
        req.session.username = username;
        res.json({ success: true });
    } else {
        res.status(401).json({ error: 'Неверный логин или пароль' });
    }
});

// Выход
app.post('/logout', (req, res) => {
    req.session.destroy((err) => {
        if (err) {
            return res.status(500).json({ error: 'Ошибка выхода' });
        }
        res.json({ success: true });
    });
});

// Проверка авторизации (для фронтенда)
app.get('/api/auth/check', (req, res) => {
    res.json({
        authenticated: !!(req.session && req.session.authenticated),
        username: req.session?.username || null
    });
});

// API: Получение списка сервисов
app.get('/api/services', requireAuth, async (req, res) => {
    try {
        const files = await fs.readdir(TRAEFIK_DYNAMIC_DIR);
        const services = [];

        for (const file of files) {
            if (file.endsWith('.yml') && file !== 'gitlab.yml') {
                const filePath = path.join(TRAEFIK_DYNAMIC_DIR, file);
                const content = await fs.readFile(filePath, 'utf8');
                const data = yaml.parse(content);

                if (data.http && data.http.routers) {
                    const routerName = Object.keys(data.http.routers)[0];
                    const router = data.http.routers[routerName];
                    const serviceName = router.service;
                    const service = data.http.services[serviceName];

                    if (router.rule) {
                        const ruleClean = sanitizeString(router.rule);
                        const domains = [];
                        // Поддержка обратных кавычек и одинарных; захват только допустимых символов домена
                        const hostRegex = /Host\([`']([a-zA-Z0-9._-]+)[`']\)/g;
                        let m;
                        while ((m = hostRegex.exec(ruleClean)) !== null) {
                            const d = sanitizeString(m[1]);
                            if (d && !domains.includes(d)) domains.push(d);
                        }
                        const domain = domains.length > 0 ? domains.join(', ') : '';
                        const server = service.loadBalancer.servers[0];
                        const urlMatch = server && server.url ? server.url.match(/http:\/\/(.+):(\d+)/) : null;
                        const internalIp = urlMatch ? sanitizeString(urlMatch[1]) : '';
                        const port = urlMatch ? sanitizeString(urlMatch[2]) : '';
                        services.push({
                            name: sanitizeString(file.replace('.yml', '')),
                            domain: domain,
                            internalIp: internalIp,
                            port: port,
                            configFile: file
                        });
                    }
                }
            }
        }

        res.json({ services });
    } catch (error) {
        console.error('Ошибка получения списка сервисов:', error);
        res.status(500).json({ error: error.message });
    }
});

// API: Создание нового сервиса
app.post('/api/services', requireAuth, async (req, res) => {
    try {
        let { name, internalIp, port, domain } = req.body;
        name = sanitizeString(name);
        internalIp = sanitizeString(internalIp);
        port = sanitizeString(port);
        domain = sanitizeString(domain);

        if (!name || !internalIp || !port) {
            return res.status(400).json({ error: 'Необходимы параметры: name, internalIp, port' });
        }

        // Определение домена
        let serviceDomain = domain;
        if (!serviceDomain && dnsConfig.domain) {
            serviceDomain = `${name}.${dnsConfig.domain}`;
        }

        if (!serviceDomain) {
            return res.status(400).json({ error: 'Домен не указан и не может быть определен' });
        }
        serviceDomain = sanitizeString(serviceDomain);

        // Получение внешнего IP
        const externalIp = await getExternalIp();

        // Создание DNS записи
        await createDnsRecord(name, externalIp);

        // Создание конфигурации Traefik
        await createTraefikConfig(name, serviceDomain, internalIp, port);

        // Перезагрузка Traefik
        reloadTraefik();

        res.json({
            success: true,
            message: 'Сервис создан успешно',
            service: {
                name: sanitizeString(name),
                domain: serviceDomain,
                internalIp: sanitizeString(internalIp),
                port: sanitizeString(port)
            }
        });
    } catch (error) {
        console.error('Ошибка создания сервиса:', error);
        res.status(500).json({ error: error.message });
    }
});

// API: Обновление сервиса (домен, IP, порт)
app.put('/api/services/:name', requireAuth, async (req, res) => {
    try {
        let name = '';
        try {
            name = decodeURIComponent(req.params.name);
        } catch (e) {
            return res.status(400).json({ error: 'Некорректное имя сервиса' });
        }
        name = sanitizeString(name);
        if (!isSafeServiceName(name)) {
            return res.status(400).json({ error: 'Недопустимое имя сервиса' });
        }
        let { internalIp, port, domain } = req.body;
        internalIp = sanitizeString(internalIp);
        port = sanitizeString(port);
        domain = sanitizeString(domain);
        if (!internalIp || !port) {
            return res.status(400).json({ error: 'Необходимы internalIp и port' });
        }
        const configPath = path.join(TRAEFIK_DYNAMIC_DIR, `${name}.yml`);
        if (!(await fs.pathExists(configPath))) {
            return res.status(404).json({ error: 'Сервис не найден' });
        }
        const content = await fs.readFile(configPath, 'utf8');
        const data = yaml.parse(content);
        const routerName = data.http && data.http.routers && Object.keys(data.http.routers)[0];
        const serviceName = data.http && data.http.services && Object.keys(data.http.services)[0];
        if (!routerName || !serviceName) {
            return res.status(500).json({ error: 'Некорректный формат конфигурации' });
        }
        const hostRule = domain ? buildHostRule(domain) : data.http.routers[routerName].rule;
        data.http.routers[routerName].rule = hostRule;
        data.http.services[serviceName].loadBalancer.servers[0].url = `http://${internalIp}:${port}`;
        await fs.writeFile(configPath, yaml.stringify(data));
        reloadTraefik();
        res.json({
            success: true,
            message: 'Сервис обновлён',
            service: { name, domain: domain || '', internalIp, port }
        });
    } catch (error) {
        console.error('Ошибка обновления сервиса:', error);
        res.status(500).json({ error: error.message });
    }
});

// API: Удаление сервиса
app.delete('/api/services/:name', requireAuth, async (req, res) => {
    try {
        let name = '';
        try {
            name = decodeURIComponent(req.params.name);
        } catch (e) {
            return res.status(400).json({ error: 'Некорректное имя сервиса' });
        }
        name = sanitizeString(name);
        if (!isSafeServiceName(name)) {
            return res.status(400).json({ error: 'Недопустимое имя сервиса' });
        }
        const configPath = path.join(TRAEFIK_DYNAMIC_DIR, `${name}.yml`);
        if (!(await fs.pathExists(configPath))) {
            return res.status(404).json({ error: 'Сервис не найден' });
        }
        await deleteTraefikConfig(name);
        await deleteDnsRecord(name);
        reloadTraefik();
        res.json({ success: true, message: 'Сервис удален' });
    } catch (error) {
        console.error('Ошибка удаления сервиса:', error);
        res.status(500).json({ error: error.message });
    }
});

// API: Получение статуса Traefik
app.get('/api/traefik/status', requireAuth, async (req, res) => {
    try {
        const response = await axios.get('http://localhost:8080/api/rawdata', { timeout: 2000 });
        res.json({ status: 'running', data: response.data });
    } catch (error) {
        res.status(500).json({ status: 'error', error: error.message });
    }
});

// ==================== Projects / Publish routes ====================

// GET /api/gitlab/projects
app.get('/api/gitlab/projects', requireAuth, async (req, res) => {
    try {
        const projects = await gitlabApi('get', '/projects?membership=true&per_page=100&order_by=name&sort=asc');
        const simplified = projects.map(p => ({
            id: p.id,
            name: p.name,
            path: p.path,
            pathWithNamespace: p.path_with_namespace,
            defaultBranch: p.default_branch,
            webUrl: p.web_url
        }));
        res.json({ projects: simplified });
    } catch (error) {
        console.error('Ошибка получения проектов GitLab:', error.message);
        res.status(500).json({ error: error.message });
    }
});

// GET /api/publish/config
app.get('/api/publish/config', requireAuth, (req, res) => {
    res.json({
        baseDomain: dnsConfig.domain || '',
        runnerTag: config.runner_tag || 'deploy-production',
        gitlabConfigured: !!(config.gitlab_url && config.gitlab_token),
        strapiConfigured: !!(config.strapi_url && config.strapi_token)
    });
});

// GET /api/publish/projects
app.get('/api/publish/projects', requireAuth, (req, res) => {
    const projects = loadProjects();
    res.json({ projects });
});

// POST /api/publish/projects — main orchestrator
app.post('/api/publish/projects', requireAuth, async (req, res) => {
    try {
        let { gitlabProjectId, slug, projectType, appType, domain, title, description } = req.body;
        slug = sanitizeString(slug);
        projectType = sanitizeString(projectType);
        appType = sanitizeString(appType || 'frontend');
        domain = sanitizeString(domain);
        title = sanitizeString(title || slug);
        description = sanitizeString(description || '');

        if (!slug || !gitlabProjectId || !projectType) {
            return res.status(400).json({ error: 'Необходимы параметры: gitlabProjectId, slug, projectType' });
        }

        // Check slug uniqueness
        const projects = loadProjects();
        if (projects.find(p => p.slug === slug)) {
            return res.status(400).json({ error: `Проект с slug "${slug}" уже существует` });
        }

        // Get project info from GitLab
        let gitlabProject;
        try {
            gitlabProject = await gitlabApi('get', `/projects/${gitlabProjectId}`);
        } catch (error) {
            return res.status(400).json({ error: `Не удалось получить проект GitLab #${gitlabProjectId}: ${error.message}` });
        }

        const defaultBranch = gitlabProject.default_branch || 'main';
        const pathWithNamespace = gitlabProject.path_with_namespace;
        const baseDomain = dnsConfig.domain || '';
        const projectDomain = domain || (baseDomain ? `${slug}.${baseDomain}` : '');
        const runnerTag = config.runner_tag || 'deploy-production';

        const steps = {};
        const projectRecord = {
            slug,
            gitlabProjectId,
            projectType,
            appType,
            domain: projectDomain,
            title,
            description,
            pathWithNamespace,
            defaultBranch,
            createdAt: new Date().toISOString(),
            steps
        };

        // Determine template
        let templateFileName;
        try {
            templateFileName = getTemplateForProject(projectType, appType);
        } catch (error) {
            return res.status(400).json({ error: error.message });
        }

        if (projectType === 'deploy') {
            // Allocate port
            const port = allocatePort(projects);
            projectRecord.ports = { frontend: port };

            // DNS
            try {
                const externalIp = await getExternalIp();
                steps.dns = await createDnsRecord(slug, externalIp);
            } catch (error) {
                steps.dns = { done: false, error: error.message };
            }

            // Traefik
            try {
                steps.traefik = await createTraefikConfig(slug, projectDomain, '127.0.0.1', port);
                reloadTraefik();
            } catch (error) {
                steps.traefik = { done: false, error: error.message };
            }

            // Create directories
            try {
                const deployPath = `/var/www/${slug}`;
                execSync(`mkdir -p ${deployPath} && chown gitlab-runner:gitlab-runner ${deployPath}`, { stdio: 'pipe' });
                steps.directories = { done: true, detail: deployPath };
            } catch (error) {
                steps.directories = { done: false, error: error.message };
            }

            // Push CI files to GitLab
            try {
                const template = loadTemplate(templateFileName);
                const rendered = renderTemplate(template, {
                    SLUG: slug,
                    DOMAIN: projectDomain,
                    PORT: String(port),
                    RUNNER_TAG: runnerTag,
                    DEFAULT_BRANCH: defaultBranch,
                    APP_TYPE: appType
                });

                const mainCi = `include:\n  - local: '.gitlab/ci/pipeline.yml'\n`;
                await pushFileToGitlab(gitlabProjectId, '.gitlab-ci.yml', mainCi, defaultBranch, `chore: add CI/CD pipeline for ${slug}`);
                await pushFileToGitlab(gitlabProjectId, '.gitlab/ci/pipeline.yml', rendered, defaultBranch, `chore: add pipeline config for ${slug}`);
                steps.ci = { done: true, detail: 'CI файлы загружены' };
            } catch (error) {
                steps.ci = { done: false, error: error.message };
            }

            // Set CI variables
            try {
                await setGitlabCiVariable(gitlabProjectId, 'DEPLOY_PATH', `/var/www/${slug}`);
                await setGitlabCiVariable(gitlabProjectId, 'PM2_APP_NAME', slug);
                steps.variables = { done: true, detail: 'DEPLOY_PATH, PM2_APP_NAME' };
            } catch (error) {
                steps.variables = { done: false, error: error.message };
            }

        } else if (projectType === 'docs') {
            // Strapi
            try {
                steps.strapi = await createOrUpdateStrapiProject(slug, { title, description });
            } catch (error) {
                steps.strapi = { done: false, error: error.message };
            }

            // Create docs directory
            try {
                const docsPath = `/var/www/docs/${slug}`;
                execSync(`mkdir -p ${docsPath} && chown gitlab-runner:gitlab-runner ${docsPath}`, { stdio: 'pipe' });
                steps.directories = { done: true, detail: docsPath };
            } catch (error) {
                steps.directories = { done: false, error: error.message };
            }

            // Push CI files
            try {
                const template = loadTemplate(templateFileName);
                const rendered = renderTemplate(template, {
                    SLUG: slug,
                    RUNNER_TAG: runnerTag,
                    DEFAULT_BRANCH: defaultBranch
                });

                const mainCi = `include:\n  - local: '.gitlab/ci/pipeline.yml'\n`;
                await pushFileToGitlab(gitlabProjectId, '.gitlab-ci.yml', mainCi, defaultBranch, `chore: add CI/CD pipeline for ${slug}`);
                await pushFileToGitlab(gitlabProjectId, '.gitlab/ci/pipeline.yml', rendered, defaultBranch, `chore: add pipeline config for ${slug}`);
                steps.ci = { done: true, detail: 'CI файлы загружены' };
            } catch (error) {
                steps.ci = { done: false, error: error.message };
            }

            // Set CI variable
            try {
                await setGitlabCiVariable(gitlabProjectId, 'DOCS_DEPLOY_PATH', `/var/www/docs/${slug}`);
                steps.variables = { done: true, detail: 'DOCS_DEPLOY_PATH' };
            } catch (error) {
                steps.variables = { done: false, error: error.message };
            }

        } else if (projectType === 'infra') {
            // Push CI files
            try {
                const template = loadTemplate(templateFileName);
                const rendered = renderTemplate(template, {
                    SLUG: slug,
                    RUNNER_TAG: runnerTag,
                    DEFAULT_BRANCH: defaultBranch
                });

                const mainCi = `include:\n  - local: '.gitlab/ci/pipeline.yml'\n`;
                await pushFileToGitlab(gitlabProjectId, '.gitlab-ci.yml', mainCi, defaultBranch, `chore: add CI/CD pipeline for ${slug}`);
                await pushFileToGitlab(gitlabProjectId, '.gitlab/ci/pipeline.yml', rendered, defaultBranch, `chore: add pipeline config for ${slug}`);
                steps.ci = { done: true, detail: 'CI файлы загружены' };
            } catch (error) {
                steps.ci = { done: false, error: error.message };
            }

            // Optionally create Strapi project
            if (config.strapi_url && config.strapi_token) {
                try {
                    steps.strapi = await createOrUpdateStrapiProject(slug, { title, description });
                } catch (error) {
                    steps.strapi = { done: false, error: error.message };
                }
            }

        } else if (projectType === 'product') {
            // Strapi
            try {
                steps.strapi = await createOrUpdateStrapiProject(slug, { title, description });
            } catch (error) {
                steps.strapi = { done: false, error: error.message };
            }

            // Create downloads directory
            try {
                const downloadsPath = `/var/www/downloads/${slug}`;
                execSync(`mkdir -p ${downloadsPath} && chown gitlab-runner:gitlab-runner ${downloadsPath}`, { stdio: 'pipe' });
                steps.directories = { done: true, detail: downloadsPath };
            } catch (error) {
                steps.directories = { done: false, error: error.message };
            }

            // Push CI files
            try {
                const template = loadTemplate(templateFileName);
                const rendered = renderTemplate(template, {
                    SLUG: slug,
                    RUNNER_TAG: runnerTag,
                    DEFAULT_BRANCH: defaultBranch
                });

                const mainCi = `include:\n  - local: '.gitlab/ci/pipeline.yml'\n`;
                await pushFileToGitlab(gitlabProjectId, '.gitlab-ci.yml', mainCi, defaultBranch, `chore: add CI/CD pipeline for ${slug}`);
                await pushFileToGitlab(gitlabProjectId, '.gitlab/ci/pipeline.yml', rendered, defaultBranch, `chore: add pipeline config for ${slug}`);
                steps.ci = { done: true, detail: 'CI файлы загружены' };
            } catch (error) {
                steps.ci = { done: false, error: error.message };
            }

            // Set CI variables
            try {
                await setGitlabCiVariable(gitlabProjectId, 'STRAPI_API_URL', config.strapi_url || '');
                await setGitlabCiVariable(gitlabProjectId, 'STRAPI_API_TOKEN', config.strapi_token || '', { masked: true });
                await setGitlabCiVariable(gitlabProjectId, 'PROJECT_SLUG', slug);
                await setGitlabCiVariable(gitlabProjectId, 'DOWNLOADS_PATH', `/var/www/downloads/${slug}`);
                steps.variables = { done: true, detail: 'STRAPI_API_URL, STRAPI_API_TOKEN, PROJECT_SLUG, DOWNLOADS_PATH' };
            } catch (error) {
                steps.variables = { done: false, error: error.message };
            }
        }

        // Save to registry
        projects.push(projectRecord);
        saveProjects(projects);

        res.json({ success: true, project: projectRecord });
    } catch (error) {
        console.error('Ошибка создания проекта:', error);
        res.status(500).json({ error: error.message });
    }
});

// DELETE /api/publish/projects/:slug
app.delete('/api/publish/projects/:slug', requireAuth, async (req, res) => {
    try {
        const slug = sanitizeString(req.params.slug);
        const projects = loadProjects();
        const idx = projects.findIndex(p => p.slug === slug);
        if (idx === -1) return res.status(404).json({ error: 'Проект не найден' });

        const project = projects[idx];

        // Откат шагов
        if (project.steps?.traefik?.done) {
            await deleteTraefikConfig(slug);
            reloadTraefik();
        }
        if (project.steps?.dns?.done) {
            await deleteDnsRecord(slug);
        }

        projects.splice(idx, 1);
        saveProjects(projects);

        res.json({ success: true, message: 'Проект удалён из реестра' });
    } catch (error) {
        console.error('Ошибка удаления проекта:', error);
        res.status(500).json({ error: error.message });
    }
});

// PUT /api/publish/projects/:slug/update-ci
app.put('/api/publish/projects/:slug/update-ci', requireAuth, async (req, res) => {
    try {
        const slug = sanitizeString(req.params.slug);
        const projects = loadProjects();
        const project = projects.find(p => p.slug === slug);
        if (!project) return res.status(404).json({ error: 'Проект не найден' });

        const { projectType, appType, gitlabProjectId, defaultBranch } = project;
        const branch = defaultBranch || 'main';
        const runnerTag = config.runner_tag || 'deploy-production';
        const baseDomain = dnsConfig.domain || '';
        const projectDomain = project.domain || (baseDomain ? `${slug}.${baseDomain}` : '');
        const port = project.ports?.frontend || allocatePort(projects);

        let templateFileName;
        try {
            templateFileName = getTemplateForProject(projectType, appType);
        } catch (error) {
            return res.status(400).json({ error: error.message });
        }

        const template = loadTemplate(templateFileName);
        const rendered = renderTemplate(template, {
            SLUG: slug,
            DOMAIN: projectDomain,
            PORT: String(port),
            RUNNER_TAG: runnerTag,
            DEFAULT_BRANCH: branch,
            APP_TYPE: appType || 'frontend'
        });

        const mainCi = `include:\n  - local: '.gitlab/ci/pipeline.yml'\n`;
        await pushFileToGitlab(gitlabProjectId, '.gitlab-ci.yml', mainCi, branch, `chore: update CI/CD pipeline for ${slug}`);
        await pushFileToGitlab(gitlabProjectId, '.gitlab/ci/pipeline.yml', rendered, branch, `chore: update pipeline config for ${slug}`);

        // Update step in registry
        if (!project.steps) project.steps = {};
        project.steps.ci = { done: true, detail: 'CI файлы обновлены', updatedAt: new Date().toISOString() };
        saveProjects(projects);

        res.json({ success: true, message: 'CI файлы обновлены' });
    } catch (error) {
        console.error('Ошибка обновления CI:', error);
        res.status(500).json({ error: error.message });
    }
});

// Главная страница (авторизация проверяется через middleware выше)
app.get('/', requireAuth, (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// Запуск сервера
app.listen(PORT, () => {
    console.log(`Management UI запущен на порту ${PORT}`);
    console.log(`Откройте http://localhost:${PORT} в браузере`);
});
