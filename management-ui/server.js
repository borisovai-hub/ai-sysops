const express = require('express');
const bodyParser = require('body-parser');
const fs = require('fs-extra');
const path = require('path');
const axios = require('axios');
const yaml = require('yaml');
const { execSync, execFileSync } = require('child_process');
const crypto = require('crypto');
const multer = require('multer');

const app = express();
const PORT = 3000;
const CONFIG_FILE = '/etc/management-ui/config.json';
const AUTH_FILE = '/etc/management-ui/auth.json';
const TRAEFIK_DYNAMIC_DIR = '/etc/traefik/dynamic';
const DNS_CONFIG_FILE = '/etc/dns-api/config.json';
const PROJECTS_FILE = '/etc/management-ui/projects.json';
const TEMPLATES_DIR = path.join(__dirname, 'templates');
const INSTALL_CONFIG_FILE = '/etc/install-config.json';
const AUTHELIA_USERS_DB = '/etc/authelia/users_database.yml';
const AUTHELIA_BINARY = '/usr/local/bin/authelia';
const AUTHELIA_NOTIFICATIONS_FILE = '/var/lib/authelia/notifications.txt';
const AUTHELIA_CONFIG_FILE = '/etc/authelia/configuration.yml';
const USER_MAILBOXES_FILE = '/etc/management-ui/user-mailboxes.json';

// Загрузка конфигурации
let config = {};
try {
    if (fs.existsSync(CONFIG_FILE)) {
        config = fs.readJsonSync(CONFIG_FILE);
    }
} catch (error) {
    console.error('Ошибка загрузки конфигурации:', error.message);
}

// Middleware
app.use(bodyParser.json());
app.use(bodyParser.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname, 'public')));

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

// Инициализация массива токенов если отсутствует
if (!authConfig.tokens) {
    authConfig.tokens = [];
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

// Сохранение конфигурации авторизации
function saveAuthConfig() {
    fs.writeJsonSync(AUTH_FILE, authConfig, { spaces: 2 });
}

// Генерация криптографически безопасного токена
function generateToken() {
    return crypto.randomBytes(32).toString('hex');
}

// Проверка Bearer-токена (timing-safe)
function validateBearerToken(token) {
    if (!token || typeof token !== 'string') return null;
    const tokenBuf = Buffer.from(token);
    for (const entry of authConfig.tokens) {
        const storedBuf = Buffer.from(entry.token);
        if (tokenBuf.length === storedBuf.length && crypto.timingSafeEqual(tokenBuf, storedBuf)) {
            return entry;
        }
    }
    return null;
}

// Middleware проверки авторизации (Bearer-токен или Authelia ForwardAuth)
function requireAuth(req, res, next) {
    // 1. Проверка Bearer-токена
    const authHeader = req.headers.authorization;
    if (authHeader && authHeader.startsWith('Bearer ')) {
        const token = authHeader.slice(7);
        const entry = validateBearerToken(token);
        if (entry) {
            req.authMethod = 'token';
            req.tokenName = entry.name;
            return next();
        }
        return res.status(401).json({ error: 'Недействительный токен' });
    }
    // 2. Authelia ForwardAuth (Remote-User header от Traefik)
    const remoteUser = req.headers['remote-user'];
    if (remoteUser) {
        req.authMethod = 'authelia';
        req.authUser = remoteUser;
        return next();
    }
    // Не авторизован
    if (req.path.startsWith('/api/')) {
        return res.status(401).json({ error: 'Требуется авторизация' });
    }
    res.status(403).send('Доступ запрещён');
}

// Middleware: только интерактивная авторизация — Authelia (для управления токенами)
function requireSessionAuth(req, res, next) {
    const remoteUser = req.headers['remote-user'];
    if (remoteUser) {
        req.authMethod = 'authelia';
        req.authUser = remoteUser;
        return next();
    }
    if (req.path.startsWith('/api/')) {
        return res.status(401).json({ error: 'Требуется авторизация через сессию' });
    }
    res.status(403).send('Доступ запрещён');
}

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

// Загрузка install-config для base_domains (borisovai.ru, borisovai.tech)
let installConfig = {};
try {
    if (fs.existsSync(INSTALL_CONFIG_FILE)) {
        installConfig = fs.readJsonSync(INSTALL_CONFIG_FILE);
    }
} catch (error) {
    console.warn('Install config не найден:', INSTALL_CONFIG_FILE);
}

// URL Management UI для CI-переменных (первый base_domain с префиксом admin)
function getManagementUiUrl() {
    const domains = getBaseDomains();
    if (domains.length > 0) return `https://admin.${domains[0]}`;
    return 'http://127.0.0.1:3000';
}

// Bearer-токен для CI — первый токен из auth.json
function getManagementUiToken() {
    try {
        const authData = fs.readJsonSync(AUTH_FILE);
        const tokens = authData.tokens || [];
        if (tokens.length > 0) return tokens[0].token;
    } catch (e) { /* */ }
    return '';
}

function getBaseDomains() {
    const raw = installConfig.base_domains || '';
    if (!raw) return [];
    return raw.split(',').map(d => d.trim()).filter(Boolean);
}

// Построить домены для всех base_domains: slug.borisovai.ru,slug.borisovai.tech
function buildAllDomains(prefix) {
    const domains = getBaseDomains();
    if (domains.length === 0) return '';
    if (!prefix) return domains.join(',');
    return domains.map(d => `${prefix}.${d}`).join(',');
}

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

// Создание DNS записей для всех base_domains (borisovai.ru + borisovai.tech)
async function createDnsRecordsForAllDomains(subdomain, ip) {
    if (!dnsConfig.provider) return { done: false, detail: 'DNS провайдер не настроен' };
    const domains = getBaseDomains();
    if (domains.length === 0) {
        return createDnsRecord(subdomain, ip);
    }
    const created = [];
    for (const baseDomain of domains) {
        try {
            await axios.post(`${DNS_API_BASE}/api/records`, {
                subdomain: sanitizeString(subdomain),
                domain: baseDomain,
                ip: sanitizeString(ip)
            }, { timeout: 5000 });
            created.push(`${subdomain}.${baseDomain}`);
        } catch (error) {
            console.warn(`DNS ошибка для ${subdomain}.${baseDomain}:`, error.message);
        }
    }
    if (created.length > 0) {
        return { done: true, detail: `A записи: ${created.join(', ')}` };
    }
    return { done: false, error: 'Не удалось создать DNS записи' };
}

async function deleteDnsRecord(subdomain) {
    if (!dnsConfig.provider) return;
    try {
        execSync(`manage-dns delete ${sanitizeString(subdomain)}`, { stdio: 'pipe' });
    } catch (error) {
        console.warn('Ошибка удаления DNS записи:', error.message);
    }
}

async function createTraefikConfig(name, domain, internalIp, port, options = {}) {
    // domain может быть через запятую: "slug.borisovai.ru,slug.borisovai.tech"
    const hostRule = buildHostRule(domain) || `Host(\`${domain}\`)`;
    const router = {
        rule: hostRule,
        service: name,
        entryPoints: ['websecure'],
        tls: { certResolver: 'letsencrypt' }
    };
    if (options.authelia) {
        router.middlewares = ['authelia@file'];
    }
    const configContent = {
        http: {
            routers: {
                [name]: router
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

async function deleteFileFromGitlab(projectId, filePath, branch, commitMessage) {
    const encodedPath = encodeURIComponent(filePath);
    try {
        await gitlabApi('delete', `/projects/${projectId}/repository/files/${encodedPath}`, {
            branch, commit_message: commitMessage
        });
    } catch (error) {
        if (error.response && error.response.status === 404) return; // файла нет — OK
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

async function createOrUpdateStrapiProject(slug, fields, options = {}) {
    try {
        // Search by slug (включая drafts)
        const existing = await strapiApi('get', `/projects?filters[slug][$eq]=${slug}&status=draft`);
        if (existing.data && existing.data.length > 0) {
            const id = existing.data[0].id;
            const updateData = { ...fields };
            if (options.draft) updateData.publishedAt = null;
            await strapiApi('put', `/projects/${id}`, { data: updateData });
            return { done: true, detail: `Strapi проект #${id} обновлён${options.draft ? ' (draft)' : ''}`, id };
        }
        // Create new — по умолчанию как draft
        const createData = { slug, ...fields };
        if (options.draft !== false) createData.publishedAt = null;
        const created = await strapiApi('post', '/projects', { data: createData });
        return { done: true, detail: `Strapi проект #${created.data.id} создан (draft)`, id: created.data.id };
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

// Выход — редирект на Authelia logout
app.get('/logout', (req, res) => {
    const baseDomains = getBaseDomains();
    const firstBase = baseDomains[0] || 'borisovai.ru';
    res.redirect(`https://auth.${firstBase}/logout`);
});
app.post('/logout', (req, res) => {
    const baseDomains = getBaseDomains();
    const firstBase = baseDomains[0] || 'borisovai.ru';
    res.json({ success: true, redirect: `https://auth.${firstBase}/logout` });
});

// Проверка авторизации (для фронтенда)
app.get('/api/auth/check', (req, res) => {
    const remoteUser = req.headers['remote-user'];
    res.json({
        authenticated: !!remoteUser,
        username: remoteUser || null,
        authMode: 'authelia'
    });
});

// API: Список токенов (без полных значений)
app.get('/api/auth/tokens', requireSessionAuth, (req, res) => {
    const tokens = (authConfig.tokens || []).map(t => ({
        id: t.id,
        name: t.name,
        createdAt: t.createdAt,
        tokenPrefix: t.token.substring(0, 8) + '...'
    }));
    res.json({ tokens });
});

// API: Создание токена
app.post('/api/auth/tokens', requireSessionAuth, (req, res) => {
    const name = sanitizeString(req.body.name);
    if (!name) {
        return res.status(400).json({ error: 'Укажите имя токена' });
    }
    if (authConfig.tokens.some(t => t.name === name)) {
        return res.status(409).json({ error: `Токен с именем "${name}" уже существует` });
    }
    const token = generateToken();
    const entry = {
        id: crypto.randomBytes(4).toString('hex'),
        name,
        token,
        createdAt: new Date().toISOString()
    };
    authConfig.tokens.push(entry);
    saveAuthConfig();
    res.json({ success: true, token: entry.token, id: entry.id, name: entry.name });
});

// API: Удаление токена
app.delete('/api/auth/tokens/:id', requireSessionAuth, (req, res) => {
    const idx = authConfig.tokens.findIndex(t => t.id === req.params.id);
    if (idx === -1) {
        return res.status(404).json({ error: 'Токен не найден' });
    }
    const removed = authConfig.tokens.splice(idx, 1)[0];
    saveAuthConfig();
    res.json({ success: true, message: `Токен "${removed.name}" удалён` });
});

// Страница токенов (авторизация на уровне Traefik/Authelia)
app.get('/tokens.html', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'tokens.html'));
});

// ==================== Управление пользователями Authelia ====================

// Чтение users_database.yml
function readAutheliaUsers() {
    if (!fs.existsSync(AUTHELIA_USERS_DB)) return {};
    const content = fs.readFileSync(AUTHELIA_USERS_DB, 'utf8');
    const data = yaml.parse(content);
    return (data && data.users) || {};
}

// Запись users_database.yml с backup и правами
function writeAutheliaUsers(users) {
    if (fs.existsSync(AUTHELIA_USERS_DB)) {
        fs.copyFileSync(AUTHELIA_USERS_DB, AUTHELIA_USERS_DB + '.backup');
    }
    const data = { users };
    fs.writeFileSync(AUTHELIA_USERS_DB, yaml.stringify(data), 'utf8');
    try {
        execSync(`chown authelia:authelia "${AUTHELIA_USERS_DB}" && chmod 600 "${AUTHELIA_USERS_DB}"`, { stdio: 'pipe' });
    } catch (e) {
        console.warn('Не удалось установить права на users_database.yml:', e.message);
    }
}

// Хеширование пароля через authelia binary (безопасно, без shell)
function hashAutheliaPassword(password) {
    const output = execFileSync(AUTHELIA_BINARY,
        ['crypto', 'hash', 'generate', 'argon2', '--password', password],
        { encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'] }
    ).trim();
    return output.replace(/^Digest:\s*/, '');
}

// Перезапуск Authelia
function restartAuthelia() {
    try {
        execSync('systemctl restart authelia', { stdio: 'pipe' });
    } catch (error) {
        console.warn('Ошибка перезапуска Authelia:', error.message);
    }
}

// Валидация username
function isValidAutheliaUsername(name) {
    if (!name || typeof name !== 'string') return false;
    return /^[a-zA-Z0-9._-]{1,64}$/.test(name);
}

// Почтовые ящики пользователей (маппинг username → mailbox email)
function readUserMailboxes() {
    try {
        if (fs.existsSync(USER_MAILBOXES_FILE)) {
            return JSON.parse(fs.readFileSync(USER_MAILBOXES_FILE, 'utf8'));
        }
    } catch (e) {}
    return {};
}

function writeUserMailboxes(data) {
    fs.writeFileSync(USER_MAILBOXES_FILE, JSON.stringify(data, null, 2), 'utf8');
}

function getUserMailbox(username) {
    const mailboxes = readUserMailboxes();
    return mailboxes[username] || `${username}@borisovai.ru`;
}

// API: Список пользователей Authelia
app.get('/api/authelia/users', requireSessionAuth, (req, res) => {
    try {
        const users = readAutheliaUsers();
        const mailboxes = readUserMailboxes();
        const result = Object.entries(users).map(([username, data]) => ({
            username,
            displayname: data.displayname || '',
            email: data.email || '',
            mailbox: mailboxes[username] || `${username}@borisovai.ru`,
            groups: data.groups || [],
            disabled: !!data.disabled
        }));
        res.json({ users: result });
    } catch (error) {
        res.status(500).json({ error: 'Ошибка чтения пользователей: ' + error.message });
    }
});

// API: Создание пользователя Authelia
app.post('/api/authelia/users', requireSessionAuth, (req, res) => {
    try {
        const username = sanitizeString(req.body.username);
        const password = req.body.password;
        const displayname = sanitizeString(req.body.displayname) || username;
        const email = sanitizeString(req.body.email) || '';
        const groups = Array.isArray(req.body.groups) ? req.body.groups.map(sanitizeString).filter(Boolean) : [];

        if (!isValidAutheliaUsername(username)) {
            return res.status(400).json({ error: 'Недопустимое имя пользователя (a-z, 0-9, ._- до 64 символов)' });
        }
        if (!password || password.length < 8) {
            return res.status(400).json({ error: 'Пароль должен быть не менее 8 символов' });
        }

        const users = readAutheliaUsers();
        if (users[username]) {
            return res.status(409).json({ error: `Пользователь "${username}" уже существует` });
        }

        users[username] = {
            disabled: false,
            displayname,
            email,
            password: hashAutheliaPassword(password),
            groups
        };

        writeAutheliaUsers(users);

        // Сохранить почтовый ящик Mailu (если указан)
        const mailbox = sanitizeString(req.body.mailbox) || '';
        if (mailbox) {
            const mailboxes = readUserMailboxes();
            mailboxes[username] = mailbox;
            writeUserMailboxes(mailboxes);
        }

        restartAuthelia();
        res.json({ success: true, message: `Пользователь "${username}" создан` });
    } catch (error) {
        res.status(500).json({ error: 'Ошибка создания пользователя: ' + error.message });
    }
});

// API: Обновление пользователя Authelia
app.put('/api/authelia/users/:username', requireSessionAuth, (req, res) => {
    try {
        const username = req.params.username;
        const users = readAutheliaUsers();

        if (!users[username]) {
            return res.status(404).json({ error: `Пользователь "${username}" не найден` });
        }

        if (req.body.displayname !== undefined) {
            users[username].displayname = sanitizeString(req.body.displayname);
        }
        if (req.body.email !== undefined) {
            users[username].email = sanitizeString(req.body.email);
        }
        if (req.body.groups !== undefined) {
            users[username].groups = Array.isArray(req.body.groups)
                ? req.body.groups.map(sanitizeString).filter(Boolean) : [];
        }
        if (req.body.disabled !== undefined) {
            users[username].disabled = !!req.body.disabled;
        }

        writeAutheliaUsers(users);

        // Обновить почтовый ящик Mailu
        if (req.body.mailbox !== undefined) {
            const mailboxes = readUserMailboxes();
            const mailbox = sanitizeString(req.body.mailbox) || '';
            if (mailbox && mailbox !== `${username}@borisovai.ru`) {
                mailboxes[username] = mailbox;
            } else {
                delete mailboxes[username]; // дефолт — не храним
            }
            writeUserMailboxes(mailboxes);
        }

        restartAuthelia();
        res.json({ success: true, message: `Пользователь "${username}" обновлён` });
    } catch (error) {
        res.status(500).json({ error: 'Ошибка обновления пользователя: ' + error.message });
    }
});

// API: Смена пароля пользователя Authelia
app.post('/api/authelia/users/:username/password', requireSessionAuth, (req, res) => {
    try {
        const username = req.params.username;
        const password = req.body.password;

        if (!password || password.length < 8) {
            return res.status(400).json({ error: 'Пароль должен быть не менее 8 символов' });
        }

        const users = readAutheliaUsers();
        if (!users[username]) {
            return res.status(404).json({ error: `Пользователь "${username}" не найден` });
        }

        users[username].password = hashAutheliaPassword(password);
        writeAutheliaUsers(users);
        restartAuthelia();
        res.json({ success: true, message: `Пароль пользователя "${username}" изменён` });
    } catch (error) {
        res.status(500).json({ error: 'Ошибка смены пароля: ' + error.message });
    }
});

// API: Удаление пользователя Authelia
app.delete('/api/authelia/users/:username', requireSessionAuth, (req, res) => {
    try {
        const username = req.params.username;
        const users = readAutheliaUsers();

        if (!users[username]) {
            return res.status(404).json({ error: `Пользователь "${username}" не найден` });
        }

        const isAdmin = (users[username].groups || []).includes('admins');
        if (isAdmin) {
            const otherAdmins = Object.entries(users).filter(
                ([u, d]) => u !== username && (d.groups || []).includes('admins') && !d.disabled
            );
            if (otherAdmins.length === 0) {
                return res.status(400).json({ error: 'Нельзя удалить последнего активного администратора' });
            }
        }

        delete users[username];
        writeAutheliaUsers(users);

        // Удалить маппинг почтового ящика
        const mailboxes = readUserMailboxes();
        if (mailboxes[username]) {
            delete mailboxes[username];
            writeUserMailboxes(mailboxes);
        }

        restartAuthelia();
        res.json({ success: true, message: `Пользователь "${username}" удалён` });
    } catch (error) {
        res.status(500).json({ error: 'Ошибка удаления пользователя: ' + error.message });
    }
});

// API: Получение уведомлений Authelia (TOTP-ссылки, коды подтверждения)
app.get('/api/authelia/notifications', requireSessionAuth, (req, res) => {
    try {
        if (!fs.existsSync(AUTHELIA_NOTIFICATIONS_FILE)) {
            return res.json({ notifications: [] });
        }
        const content = fs.readFileSync(AUTHELIA_NOTIFICATIONS_FILE, 'utf8');
        if (!content.trim()) return res.json({ notifications: [] });
        // Файл содержит одно или несколько уведомлений, разделённых двойным переводом строки + "Date:"
        const blocks = content.split(/(?=^Date: )/m).filter(b => b.trim());
        const notifications = blocks.map(block => {
            const dateMatch = block.match(/^Date: (.+)$/m);
            const recipientMatch = block.match(/^Recipient: \{(.+?)\}$/m);
            const subjectMatch = block.match(/^Subject: (.+)$/m);
            const bodyStart = block.indexOf('\n', block.indexOf('Subject:'));
            const body = bodyStart > -1 ? block.slice(bodyStart + 1).trim() : '';
            // Извлечь email из Recipient: {Display Name email@example.com}
            let recipientEmail = '';
            let recipientName = '';
            if (recipientMatch) {
                const parts = recipientMatch[1].trim();
                const emailMatch = parts.match(/[\w.-]+@[\w.-]+/);
                if (emailMatch) {
                    recipientEmail = emailMatch[0];
                    recipientName = parts.replace(recipientEmail, '').trim();
                }
            }
            return {
                date: dateMatch ? dateMatch[1].trim() : '',
                recipientEmail,
                recipientName,
                subject: subjectMatch ? subjectMatch[1].trim() : '',
                body
            };
        }).reverse(); // Последние сверху
        res.json({ notifications });
    } catch (error) {
        res.status(500).json({ error: 'Ошибка чтения уведомлений: ' + error.message });
    }
});

// API: Получение настроек notifier Authelia
app.get('/api/authelia/notifier', requireSessionAuth, (req, res) => {
    try {
        if (!fs.existsSync(AUTHELIA_CONFIG_FILE)) {
            return res.status(404).json({ error: 'Конфигурация Authelia не найдена' });
        }
        const content = fs.readFileSync(AUTHELIA_CONFIG_FILE, 'utf8');
        const config = yaml.parse(content);
        const notifier = config.notifier || {};
        const type = notifier.smtp ? 'smtp' : 'filesystem';
        const smtp = notifier.smtp || {};
        res.json({
            type,
            smtp: {
                host: smtp.address ? smtp.address.replace(/^(tcp|smtp|smtps):\/\//, '').replace(/:\d+$/, '') : '',
                port: smtp.address ? parseInt(smtp.address.replace(/.*:/, '')) || 587 : 587,
                sender: smtp.sender || '',
                username: smtp.username || '',
                password: smtp.password ? '********' : '',
                tls_skip_verify: !!(smtp.tls && smtp.tls.skip_verify)
            }
        });
    } catch (error) {
        res.status(500).json({ error: 'Ошибка чтения конфигурации: ' + error.message });
    }
});

// API: Обновление настроек notifier Authelia (filesystem ↔ smtp)
// Используем string-замену блока notifier, чтобы не ломать multiline YAML (OIDC private key)
app.put('/api/authelia/notifier', requireSessionAuth, (req, res) => {
    try {
        const { type, smtp } = req.body;
        if (!type || !['filesystem', 'smtp'].includes(type)) {
            return res.status(400).json({ error: 'Тип должен быть filesystem или smtp' });
        }
        if (type === 'smtp') {
            if (!smtp || !smtp.host || !smtp.sender) {
                return res.status(400).json({ error: 'Для SMTP нужны host и sender' });
            }
        }
        if (!fs.existsSync(AUTHELIA_CONFIG_FILE)) {
            return res.status(404).json({ error: 'Конфигурация Authelia не найдена' });
        }
        const content = fs.readFileSync(AUTHELIA_CONFIG_FILE, 'utf8');
        // Построить новый блок notifier
        let newBlock;
        if (type === 'filesystem') {
            newBlock = [
                'notifier:',
                '  filesystem:',
                '    filename: /var/lib/authelia/notifications.txt'
            ].join('\n');
        } else {
            const port = smtp.port || 25;
            const lines = [
                'notifier:',
                '  disable_startup_check: true',
                '  smtp:',
                `    address: smtp://${smtp.host}:${port}`,
                `    sender: ${smtp.sender}`,
                '    subject: "[Authelia] {title}"',
                '    disable_require_tls: true'
            ];
            if (smtp.username) {
                lines.push(`    username: ${smtp.username}`);
                if (smtp.password && smtp.password !== '********') {
                    lines.push(`    password: ${smtp.password}`);
                } else {
                    // Сохранить старый пароль из текущего конфига
                    const parsed = yaml.parse(content);
                    const oldPass = parsed.notifier && parsed.notifier.smtp && parsed.notifier.smtp.password;
                    if (oldPass) lines.push(`    password: ${oldPass}`);
                }
            }
            if (smtp.tls_skip_verify) {
                lines.push('    tls:');
                lines.push('      skip_verify: true');
            }
            newBlock = lines.join('\n');
        }
        // Заменить блок notifier: ... до следующей top-level секции
        const replaced = content.replace(
            /^notifier:\n(?:[ \t]+.*\n)*/m,
            newBlock + '\n'
        );
        if (replaced === content && !content.includes('notifier:')) {
            return res.status(500).json({ error: 'Блок notifier не найден в конфигурации' });
        }
        fs.copyFileSync(AUTHELIA_CONFIG_FILE, AUTHELIA_CONFIG_FILE + '.backup');
        fs.writeFileSync(AUTHELIA_CONFIG_FILE, replaced, 'utf8');
        try { execSync(`chown authelia:authelia "${AUTHELIA_CONFIG_FILE}" && chmod 600 "${AUTHELIA_CONFIG_FILE}"`, { stdio: 'pipe' }); } catch(e) {}
        restartAuthelia();
        res.json({ success: true, message: `Notifier переключён на ${type}. Authelia перезапущена.` });
    } catch (error) {
        res.status(500).json({ error: 'Ошибка обновления конфигурации: ' + error.message });
    }
});

// Страница пользователей Authelia
app.get('/users.html', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'users.html'));
});

// ForwardAuth endpoint для Mailu: маппинг Remote-User → Remote-Email (почтовый ящик)
// Вызывается Traefik как ForwardAuth middleware (без session auth — приходит от Traefik, не от браузера)
app.get('/api/mailu/auth', (req, res) => {
    const remoteUser = req.headers['remote-user'];
    if (!remoteUser) {
        return res.status(401).end();
    }
    const mailbox = getUserMailbox(remoteUser);
    res.set('Remote-Email', mailbox);
    res.status(200).end();
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
                    const routerNames = Object.keys(data.http.routers);
                    for (const routerName of routerNames) {
                        const router = data.http.routers[routerName];
                        const serviceName = router.service;
                        const service = data.http.services && data.http.services[serviceName];

                        if (router.rule && service) {
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
                            const server = service.loadBalancer && service.loadBalancer.servers && service.loadBalancer.servers[0];
                            const urlMatch = server && server.url ? server.url.match(/http:\/\/(.+):(\d+)/) : null;
                            const internalIp = urlMatch ? sanitizeString(urlMatch[1]) : '';
                            const port = urlMatch ? sanitizeString(urlMatch[2]) : '';
                            services.push({
                                name: sanitizeString(routerNames.length > 1 ? routerName : file.replace('.yml', '')),
                                domain: domain,
                                internalIp: internalIp,
                                port: port,
                                configFile: file
                            });
                        }
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

        // Определение домена (все base_domains если не задан явно)
        let serviceDomain = domain;
        if (!serviceDomain) {
            serviceDomain = buildAllDomains(name) || (dnsConfig.domain ? `${name}.${dnsConfig.domain}` : '');
        }

        if (!serviceDomain) {
            return res.status(400).json({ error: 'Домен не указан и не может быть определен' });
        }
        serviceDomain = sanitizeString(serviceDomain);

        // Получение внешнего IP
        const externalIp = await getExternalIp();

        // Создание DNS записей для всех base_domains
        await createDnsRecordsForAllDomains(name, externalIp);

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

// Хелпер: найти конфиг-файл сервиса по имени (учитывает мульти-роутерные файлы)
async function findServiceConfig(name) {
    // Сначала пробуем прямое соответствие: name → name.yml
    const directPath = path.join(TRAEFIK_DYNAMIC_DIR, `${name}.yml`);
    if (await fs.pathExists(directPath)) {
        return { configPath: directPath, configFile: `${name}.yml`, routerName: null };
    }
    // Если прямого файла нет — ищем роутер с таким именем во всех YAML-файлах
    const files = await fs.readdir(TRAEFIK_DYNAMIC_DIR);
    for (const file of files) {
        if (!file.endsWith('.yml')) continue;
        const filePath = path.join(TRAEFIK_DYNAMIC_DIR, file);
        const content = await fs.readFile(filePath, 'utf8');
        const data = yaml.parse(content);
        if (data.http && data.http.routers && data.http.routers[name]) {
            return { configPath: filePath, configFile: file, routerName: name };
        }
    }
    return null;
}

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
        const found = await findServiceConfig(name);
        if (!found) {
            return res.status(404).json({ error: 'Сервис не найден' });
        }
        const { configPath, routerName: foundRouter } = found;
        const content = await fs.readFile(configPath, 'utf8');
        const data = yaml.parse(content);
        // Для мульти-роутерных файлов обновляем конкретный роутер, для обычных — первый
        const targetRouter = foundRouter || (data.http && data.http.routers && Object.keys(data.http.routers)[0]);
        const serviceName = data.http && data.http.services && Object.keys(data.http.services)[0];
        if (!targetRouter || !serviceName) {
            return res.status(500).json({ error: 'Некорректный формат конфигурации' });
        }
        const hostRule = domain ? buildHostRule(domain) : data.http.routers[targetRouter].rule;
        data.http.routers[targetRouter].rule = hostRule;
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
        const found = await findServiceConfig(name);
        if (!found) {
            return res.status(404).json({ error: 'Сервис не найден' });
        }
        if (found.routerName) {
            // Мульти-роутерный файл: удаляем конкретный роутер
            const content = await fs.readFile(found.configPath, 'utf8');
            const data = yaml.parse(content);
            delete data.http.routers[found.routerName];
            const remainingRouters = Object.keys(data.http.routers);
            if (remainingRouters.length === 0) {
                // Все роутеры удалены — удаляем файл целиком
                await fs.remove(found.configPath);
            } else {
                await fs.writeFile(found.configPath, yaml.stringify(data));
            }
        } else {
            await deleteTraefikConfig(name);
        }
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
    const domains = getBaseDomains();
    res.json({
        baseDomain: domains[0] || dnsConfig.domain || '',
        baseDomains: domains.length > 0 ? domains : (dnsConfig.domain ? [dnsConfig.domain] : []),
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
        let { gitlabProjectId, slug, projectType, appType, domain, title, description, authelia } = req.body;
        slug = sanitizeString(slug);
        projectType = sanitizeString(projectType);
        appType = sanitizeString(appType || 'frontend');
        domain = sanitizeString(domain);
        title = sanitizeString(title || slug);
        description = sanitizeString(description || '');

        if (!slug || !gitlabProjectId || !projectType) {
            return res.status(400).json({ error: 'Необходимы параметры: gitlabProjectId, slug, projectType' });
        }

        // Check slug uniqueness (force: true позволяет перерегистрацию)
        const projects = loadProjects();
        const existingIdx = projects.findIndex(p => p.slug === slug);
        if (existingIdx !== -1 && !req.body.force) {
            return res.status(409).json({
                error: `Проект с slug "${slug}" уже существует. Используйте force:true для перерегистрации.`,
                existingProject: projects[existingIdx]
            });
        }
        if (existingIdx !== -1) {
            // Перерегистрация: удалить старую запись
            projects.splice(existingIdx, 1);
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
        // Все base_domains если домен не задан явно
        const projectDomain = domain || buildAllDomains(slug) || (dnsConfig.domain ? `${slug}.${dnsConfig.domain}` : '');
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
            authelia: authelia !== false,
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

            // DNS (для всех base_domains)
            try {
                const externalIp = await getExternalIp();
                steps.dns = await createDnsRecordsForAllDomains(slug, externalIp);
            } catch (error) {
                steps.dns = { done: false, error: error.message };
            }

            // Traefik
            try {
                steps.traefik = await createTraefikConfig(slug, projectDomain, '127.0.0.1', port, { authelia: authelia !== false });
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

            // Set CI variables
            try {
                const managementUiUrl = getManagementUiUrl();
                const managementUiToken = getManagementUiToken();
                await setGitlabCiVariable(gitlabProjectId, 'DOCS_DEPLOY_PATH', `/var/www/docs/${slug}`);
                await setGitlabCiVariable(gitlabProjectId, 'PROJECT_SLUG', slug);
                await setGitlabCiVariable(gitlabProjectId, 'MANAGEMENT_UI_URL', managementUiUrl);
                await setGitlabCiVariable(gitlabProjectId, 'MANAGEMENT_UI_TOKEN', managementUiToken, { masked: true });
                steps.variables = { done: true, detail: 'DOCS_DEPLOY_PATH, PROJECT_SLUG, MANAGEMENT_UI_URL, MANAGEMENT_UI_TOKEN' };
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

            // Set CI variables — Management UI webhook вместо прямого Strapi
            try {
                const managementUiUrl = getManagementUiUrl();
                const managementUiToken = getManagementUiToken();
                await setGitlabCiVariable(gitlabProjectId, 'MANAGEMENT_UI_URL', managementUiUrl);
                await setGitlabCiVariable(gitlabProjectId, 'MANAGEMENT_UI_TOKEN', managementUiToken, { masked: true });
                await setGitlabCiVariable(gitlabProjectId, 'PROJECT_SLUG', slug);
                await setGitlabCiVariable(gitlabProjectId, 'DOWNLOADS_PATH', `/var/www/downloads/${slug}`);
                steps.variables = { done: true, detail: 'MANAGEMENT_UI_URL, MANAGEMENT_UI_TOKEN, PROJECT_SLUG, DOWNLOADS_PATH' };
            } catch (error) {
                steps.variables = { done: false, error: error.message };
            }
        }

        // Статус: ok если все шаги успешны, partial если есть ошибки
        projectRecord.status = Object.values(steps).every(s => s?.done) ? 'ok' : 'partial';

        // Save to registry
        projects.push(projectRecord);
        saveProjects(projects);

        res.json({ success: true, project: projectRecord });
    } catch (error) {
        console.error('Ошибка создания проекта:', error);
        res.status(500).json({ error: error.message });
    }
});

// PUT /api/publish/projects/:slug/retry — повторить failed шаги
app.put('/api/publish/projects/:slug/retry', requireAuth, async (req, res) => {
    try {
        const slug = sanitizeString(req.params.slug);
        const projects = loadProjects();
        const project = projects.find(p => p.slug === slug);
        if (!project) return res.status(404).json({ error: 'Проект не найден' });

        const steps = project.steps || {};
        const { gitlabProjectId, defaultBranch, projectType, appType, domain: projectDomain } = project;
        const branch = defaultBranch || 'main';
        const runnerTag = config.runner_tag || 'deploy-production';
        const port = project.ports?.frontend;
        const title = project.title || slug;
        const description = project.description || '';
        let retried = [];

        // Retry DNS
        if (steps.dns && !steps.dns.done && projectType === 'deploy') {
            try {
                const externalIp = await getExternalIp();
                steps.dns = await createDnsRecordsForAllDomains(slug, externalIp);
                retried.push('dns');
            } catch (error) {
                steps.dns = { done: false, error: error.message };
            }
        }

        // Retry Traefik
        if (steps.traefik && !steps.traefik.done && projectType === 'deploy' && port) {
            try {
                steps.traefik = await createTraefikConfig(slug, projectDomain, '127.0.0.1', port, { authelia: project.authelia !== false });
                reloadTraefik();
                retried.push('traefik');
            } catch (error) {
                steps.traefik = { done: false, error: error.message };
            }
        }

        // Retry directories
        if (steps.directories && !steps.directories.done) {
            try {
                let dirPath;
                if (projectType === 'deploy') dirPath = `/var/www/${slug}`;
                else if (projectType === 'docs') dirPath = `/var/www/docs/${slug}`;
                else if (projectType === 'product') dirPath = `/var/www/downloads/${slug}`;
                if (dirPath) {
                    execSync(`mkdir -p ${dirPath} && chown -R gitlab-runner:gitlab-runner ${dirPath}`, { stdio: 'pipe' });
                    steps.directories = { done: true, detail: dirPath };
                    retried.push('directories');
                }
            } catch (error) {
                steps.directories = { done: false, error: error.message };
            }
        }

        // Retry CI
        if (steps.ci && !steps.ci.done && gitlabProjectId) {
            try {
                const templateFileName = getTemplateForProject(projectType, appType);
                const template = loadTemplate(templateFileName);
                const rendered = renderTemplate(template, {
                    SLUG: slug, DOMAIN: projectDomain || '', PORT: String(port || ''),
                    RUNNER_TAG: runnerTag, DEFAULT_BRANCH: branch, APP_TYPE: appType || 'frontend'
                });
                const mainCi = `include:\n  - local: '.gitlab/ci/pipeline.yml'\n`;
                await pushFileToGitlab(gitlabProjectId, '.gitlab-ci.yml', mainCi, branch, `chore: CI retry for ${slug}`);
                await pushFileToGitlab(gitlabProjectId, '.gitlab/ci/pipeline.yml', rendered, branch, `chore: pipeline retry for ${slug}`);
                steps.ci = { done: true, detail: 'CI файлы загружены (retry)' };
                retried.push('ci');
            } catch (error) {
                steps.ci = { done: false, error: error.message };
            }
        }

        // Retry Strapi
        if (steps.strapi && !steps.strapi.done) {
            try {
                steps.strapi = await createOrUpdateStrapiProject(slug, { title, description });
                retried.push('strapi');
            } catch (error) {
                steps.strapi = { done: false, error: error.message };
            }
        }

        // Retry variables
        if (steps.variables && !steps.variables.done && gitlabProjectId) {
            try {
                if (projectType === 'deploy') {
                    await setGitlabCiVariable(gitlabProjectId, 'DEPLOY_PATH', `/var/www/${slug}`);
                    await setGitlabCiVariable(gitlabProjectId, 'PM2_APP_NAME', slug);
                } else if (projectType === 'product') {
                    const managementUiUrl = getManagementUiUrl();
                    const managementUiToken = getManagementUiToken();
                    await setGitlabCiVariable(gitlabProjectId, 'MANAGEMENT_UI_URL', managementUiUrl);
                    await setGitlabCiVariable(gitlabProjectId, 'MANAGEMENT_UI_TOKEN', managementUiToken, { masked: true });
                    await setGitlabCiVariable(gitlabProjectId, 'PROJECT_SLUG', slug);
                    await setGitlabCiVariable(gitlabProjectId, 'DOWNLOADS_PATH', `/var/www/downloads/${slug}`);
                } else if (projectType === 'docs') {
                    const managementUiUrl = getManagementUiUrl();
                    const managementUiToken = getManagementUiToken();
                    await setGitlabCiVariable(gitlabProjectId, 'DOCS_DEPLOY_PATH', `/var/www/docs/${slug}`);
                    await setGitlabCiVariable(gitlabProjectId, 'PROJECT_SLUG', slug);
                    await setGitlabCiVariable(gitlabProjectId, 'MANAGEMENT_UI_URL', managementUiUrl);
                    await setGitlabCiVariable(gitlabProjectId, 'MANAGEMENT_UI_TOKEN', managementUiToken, { masked: true });
                }
                steps.variables = { done: true, detail: 'CI переменные (retry)' };
                retried.push('variables');
            } catch (error) {
                steps.variables = { done: false, error: error.message };
            }
        }

        project.status = Object.values(steps).every(s => s?.done) ? 'ok' : 'partial';
        saveProjects(projects);

        res.json({ success: true, retried, project });
    } catch (error) {
        console.error('Ошибка retry проекта:', error);
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
        // Удаление CI файлов из GitLab-репозитория
        if (project.steps?.ci?.done && project.gitlabProjectId) {
            try {
                const branch = project.defaultBranch || 'main';
                await deleteFileFromGitlab(project.gitlabProjectId, '.gitlab/ci/pipeline.yml', branch, `chore: удаление CI для ${slug}`);
                await deleteFileFromGitlab(project.gitlabProjectId, '.gitlab-ci.yml', branch, `chore: удаление CI для ${slug}`);
            } catch (error) {
                console.warn(`Не удалось удалить CI файлы для ${slug}:`, error.message);
            }
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

// POST /api/publish/projects/:slug/release — webhook от CI/агента для обновления версии (draft)
app.post('/api/publish/projects/:slug/release', requireAuth, async (req, res) => {
    try {
        const slug = sanitizeString(req.params.slug);
        const { version, downloadUrl, changelog, source } = req.body;

        if (!version) {
            return res.status(400).json({ error: 'Необходим параметр: version' });
        }

        const projects = loadProjects();
        const project = projects.find(p => p.slug === slug);
        if (!project) return res.status(404).json({ error: `Проект "${slug}" не найден в реестре` });

        // Обновить Strapi (version, downloadUrl) как draft
        const updateFields = { version };
        if (downloadUrl) updateFields.downloadUrl = downloadUrl;
        if (changelog) updateFields.changelog = changelog;

        let strapiResult = null;
        try {
            strapiResult = await createOrUpdateStrapiProject(slug, updateFields, { draft: true });
        } catch (error) {
            console.warn(`Release ${slug}: не удалось обновить Strapi:`, error.message);
        }

        // Записать в releases[]
        if (!project.releases) project.releases = [];
        const release = {
            version,
            downloadUrl: downloadUrl || '',
            changelog: changelog || '',
            source: source || 'unknown',
            action: 'release',
            strapiUpdated: strapiResult?.done || false,
            at: new Date().toISOString()
        };
        project.releases.unshift(release);
        saveProjects(projects);

        res.json({ success: true, release, strapiResult });
    } catch (error) {
        console.error('Ошибка release:', error);
        res.status(500).json({ error: error.message });
    }
});

// GET /api/publish/projects/:slug/releases — история релизов
app.get('/api/publish/projects/:slug/releases', requireAuth, (req, res) => {
    const slug = sanitizeString(req.params.slug);
    const projects = loadProjects();
    const project = projects.find(p => p.slug === slug);
    if (!project) return res.status(404).json({ error: 'Проект не найден' });
    res.json({ releases: project.releases || [] });
});

// ============================================================
// Управление контентом — Draft/Publish
// ============================================================

// GET /api/content/drafts — список черновиков из Strapi
app.get('/api/content/drafts', requireAuth, async (req, res) => {
    try {
        const drafts = [];
        // Получить draft-проекты
        try {
            const projects = await strapiApi('get', '/projects?status=draft&pagination[pageSize]=100');
            if (projects.data) {
                for (const item of projects.data) {
                    drafts.push({
                        id: item.id,
                        contentType: 'projects',
                        title: item.title || item.slug || `#${item.id}`,
                        slug: item.slug,
                        updatedAt: item.updatedAt,
                        publishedAt: item.publishedAt
                    });
                }
            }
        } catch (e) { console.warn('Не удалось получить draft-проекты:', e.message); }

        // Получить draft-notes (v1 plugin)
        try {
            const notes = await strapiApi('get', '/notes?status=draft&pagination[pageSize]=100');
            if (notes.data) {
                for (const item of notes.data) {
                    drafts.push({
                        id: item.id,
                        contentType: 'notes',
                        title: item.title_ru || item.title_en || `#${item.id}`,
                        slug: item.slug,
                        updatedAt: item.updatedAt,
                        publishedAt: item.publishedAt
                    });
                }
            }
        } catch (e) { /* notes могут не существовать */ }

        res.json({ success: true, drafts });
    } catch (error) {
        console.error('Ошибка получения черновиков:', error);
        res.status(500).json({ error: error.message });
    }
});

// PUT /api/content/:contentType/:id/publish — опубликовать запись
app.put('/api/content/:contentType/:id/publish', requireAuth, async (req, res) => {
    try {
        const { contentType, id } = req.params;
        const allowedTypes = ['projects', 'notes', 'threads', 'blog-notes'];
        if (!allowedTypes.includes(contentType)) {
            return res.status(400).json({ error: `Недопустимый content type: ${contentType}` });
        }

        const now = new Date().toISOString();
        await strapiApi('put', `/${contentType}/${id}`, { data: { publishedAt: now } });

        // Записать в аудит-лог если это проект
        if (contentType === 'projects') {
            try {
                const strapiProject = await strapiApi('get', `/${contentType}/${id}`);
                const slug = strapiProject.data?.slug;
                if (slug) {
                    const projects = loadProjects();
                    const project = projects.find(p => p.slug === slug);
                    if (project) {
                        if (!project.releases) project.releases = [];
                        project.releases.unshift({
                            version: strapiProject.data?.version || '',
                            source: 'admin',
                            action: 'publish',
                            at: now
                        });
                        saveProjects(projects);
                    }
                }
            } catch (e) { console.warn('Не удалось обновить аудит-лог:', e.message); }
        }

        res.json({ success: true, message: `Опубликовано: ${contentType}/${id}` });
    } catch (error) {
        console.error('Ошибка публикации:', error);
        res.status(500).json({ error: error.message });
    }
});

// PUT /api/content/:contentType/:id/unpublish — снять с публикации
app.put('/api/content/:contentType/:id/unpublish', requireAuth, async (req, res) => {
    try {
        const { contentType, id } = req.params;
        const allowedTypes = ['projects', 'notes', 'threads', 'blog-notes'];
        if (!allowedTypes.includes(contentType)) {
            return res.status(400).json({ error: `Недопустимый content type: ${contentType}` });
        }

        await strapiApi('put', `/${contentType}/${id}`, { data: { publishedAt: null } });

        // Аудит-лог для проектов
        if (contentType === 'projects') {
            try {
                const strapiProject = await strapiApi('get', `/${contentType}/${id}?status=draft`);
                const slug = strapiProject.data?.slug;
                if (slug) {
                    const projects = loadProjects();
                    const project = projects.find(p => p.slug === slug);
                    if (project) {
                        if (!project.releases) project.releases = [];
                        project.releases.unshift({
                            version: strapiProject.data?.version || '',
                            source: 'admin',
                            action: 'unpublish',
                            at: new Date().toISOString()
                        });
                        saveProjects(projects);
                    }
                }
            } catch (e) { console.warn('Не удалось обновить аудит-лог:', e.message); }
        }

        res.json({ success: true, message: `Снято с публикации: ${contentType}/${id}` });
    } catch (error) {
        console.error('Ошибка снятия с публикации:', error);
        res.status(500).json({ error: error.message });
    }
});

// ============================================================
// Туннели (frp) — статус, прокси, конфиг клиента
// ============================================================

const FRP_CONFIG_FILE = '/etc/frp/frps.toml';

function readFrpsConfig() {
    try {
        if (!fs.existsSync(FRP_CONFIG_FILE)) return null;
        const content = fs.readFileSync(FRP_CONFIG_FILE, 'utf8');
        const config = {};
        for (const line of content.split('\n')) {
            const match = line.match(/^([a-zA-Z_.]+)\s*=\s*"?([^"]*)"?\s*$/);
            if (match) config[match[1]] = match[2];
        }
        return config;
    } catch { return null; }
}

async function frpsDashboardRequest(apiPath) {
    const cfg = readFrpsConfig();
    if (!cfg) throw new Error('frps не установлен');
    const port = cfg['webServer.port'] || '17490';
    const user = cfg['webServer.user'] || 'admin';
    const pass = cfg['webServer.password'] || '';
    const resp = await axios.get(`http://127.0.0.1:${port}${apiPath}`, {
        auth: { username: user, password: pass },
        timeout: 5000
    });
    return resp.data;
}

app.get('/tunnels.html', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'tunnels.html'));
});

app.get('/api/tunnels/status', requireAuth, async (req, res) => {
    const cfg = readFrpsConfig();
    if (!cfg) return res.json({ installed: false });
    try {
        const info = await frpsDashboardRequest('/api/serverinfo');
        res.json({ installed: true, running: true, ...info });
    } catch (error) {
        res.json({ installed: true, running: false, error: error.message });
    }
});

app.get('/api/tunnels/proxies', requireAuth, async (req, res) => {
    const cfg = readFrpsConfig();
    if (!cfg) return res.json({ proxies: [] });
    try {
        const [httpRes, tcpRes] = await Promise.all([
            frpsDashboardRequest('/api/proxy/http').catch(() => ({ proxies: [] })),
            frpsDashboardRequest('/api/proxy/tcp').catch(() => ({ proxies: [] }))
        ]);
        const proxies = [
            ...(httpRes.proxies || []).map(p => ({ ...p, tunnelType: 'http' })),
            ...(tcpRes.proxies || []).map(p => ({ ...p, tunnelType: 'tcp' }))
        ];
        res.json({ proxies });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

app.get('/api/tunnels/config', requireSessionAuth, (req, res) => {
    const cfg = readFrpsConfig();
    if (!cfg) return res.json({ installed: false });
    const baseDomains = getBaseDomains();
    res.json({
        installed: true,
        serverAddr: baseDomains[0] || '',
        controlPort: cfg['bindPort'] || '17420',
        subdomainHost: cfg['subdomainHost'] || '',
        authToken: cfg['auth.token'] || ''
    });
});

app.get('/api/tunnels/client-config', requireSessionAuth, (req, res) => {
    const cfg = readFrpsConfig();
    if (!cfg) return res.status(404).json({ error: 'frps не установлен' });
    const subdomain = sanitizeString(req.query.subdomain || 'my-project').replace(/[^a-zA-Z0-9-]/g, '');
    const localPort = parseInt(req.query.localPort, 10) || 3000;
    const baseDomains = getBaseDomains();
    const serverAddr = baseDomains[0] || '';
    const toml = [
        `serverAddr = "${serverAddr}"`,
        `serverPort = ${cfg['bindPort'] || '17420'}`,
        `auth.token = "${cfg['auth.token'] || ''}"`,
        '',
        '[[proxies]]',
        `name = "${subdomain}"`,
        'type = "http"',
        `localPort = ${localPort}`,
        `subdomain = "${subdomain}"`,
    ].join('\n');
    res.setHeader('Content-Type', 'application/toml');
    res.setHeader('Content-Disposition', 'attachment; filename="frpc.toml"');
    res.send(toml);
});

// ============================================================
// Аналитика (Umami) — статус
// ============================================================

// GET /api/analytics/status — статус Umami Analytics
app.get('/api/analytics/status', requireAuth, async (req, res) => {
    try {
        // Проверка Docker контейнера
        let isRunning = false;
        try {
            const output = execSync('docker ps --filter name=umami --format "{{.Names}}"', {
                encoding: 'utf8',
                stdio: 'pipe'
            }).trim();
            isRunning = output === 'umami';
        } catch (error) {
            // Docker не установлен или контейнер не найден
            isRunning = false;
        }

        // Health check
        let healthy = false;
        if (isRunning) {
            try {
                const response = await axios.get('http://127.0.0.1:3001/api/heartbeat', { timeout: 3000 });
                healthy = response.status === 200;
            } catch (error) {
                healthy = false;
            }
        }

        // Получаем домены (функция buildAllDomains уже существует в server.js)
        const prefix = installConfig.analytics_prefix || 'analytics';
        const middle = installConfig.analytics_middle || 'dev';
        const fullPrefix = `${prefix}.${middle}`;
        const domains = buildAllDomains(fullPrefix);

        res.json({
            installed: isRunning,
            running: healthy,
            domains: domains ? domains.split(',') : [],
            port: installConfig.umami_port || 3001,
            script_name: installConfig.umami_tracker_script || 'stats'
        });
    } catch (error) {
        res.status(500).json({
            installed: false,
            running: false,
            error: error.message
        });
    }
});

// SSO bridge для Umami Analytics — автологин через Authelia
// Traefik направляет analytics.dev.*/sso-bridge → management-ui (этот сервер)
// Страница сохраняет auth-токен в localStorage и редиректит на Umami dashboard
app.get('/sso-bridge', async (req, res) => {
    // Проверяем что запрос прошёл через Authelia ForwardAuth
    const remoteUser = req.headers['remote-user'];
    if (!remoteUser) {
        return res.status(403).send('Доступ запрещён (требуется аутентификация через Authelia)');
    }
    try {
        const umamiPort = installConfig.umami_port || 3001;
        const umamiPassword = config.umami_admin_password || 'umami';
        const loginResp = await axios.post(`http://127.0.0.1:${umamiPort}/api/auth/login`, {
            username: 'admin',
            password: umamiPassword
        }, { timeout: 5000 });
        const token = loginResp.data.token;
        if (!token) {
            return res.status(500).send('Umami SSO: токен не получен');
        }
        // Umami хранит auth в localStorage: key="umami.auth", value=JSON.stringify(token)
        const tokenJson = JSON.stringify(token);
        res.send(`<!DOCTYPE html>
<html><head><meta charset="utf-8"><title>Вход...</title></head>
<body><p>Выполняется вход в Umami Analytics...</p>
<script>
try {
  localStorage.setItem("umami.auth", ${JSON.stringify(tokenJson)});
} catch(e) { console.error("SSO storage error:", e); }
window.location.replace("/");
</script></body></html>`);
    } catch (error) {
        console.error('Umami SSO bridge ошибка:', error.message);
        res.status(500).send('SSO вход не удался: ' + error.message);
    }
});

// ============================================================
// RU Proxy — управление российским reverse proxy (Caddy)
// ============================================================

function getRuProxyConfig() {
    return {
        url: (installConfig.ru_proxy_api_url || '').replace(/\/+$/, ''),
        token: installConfig.ru_proxy_api_token || ''
    };
}

async function ruProxyApi(method, apiPath, data) {
    const cfg = getRuProxyConfig();
    if (!cfg.url || !cfg.token) {
        throw new Error('RU Proxy не настроен (ru_proxy_api_url, ru_proxy_api_token в install-config.json)');
    }
    const opts = {
        method,
        url: `${cfg.url}${apiPath}`,
        headers: { 'Authorization': `Bearer ${cfg.token}` },
        timeout: 10000
    };
    if (data) opts.data = data;
    const resp = await axios(opts);
    return resp.data;
}

app.get('/ru-proxy.html', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'ru-proxy.html'));
});

// GET /api/ru-proxy/status — статус RU Proxy (Caddy + API)
app.get('/api/ru-proxy/status', requireAuth, async (req, res) => {
    const cfg = getRuProxyConfig();
    if (!cfg.url) return res.json({ configured: false });
    try {
        const data = await ruProxyApi('get', '/api/health');
        res.json({ configured: true, reachable: true, ...data });
    } catch (error) {
        res.json({ configured: true, reachable: false, error: error.message });
    }
});

// GET /api/ru-proxy/domains — список проксируемых доменов
app.get('/api/ru-proxy/domains', requireAuth, async (req, res) => {
    try {
        const data = await ruProxyApi('get', '/api/domains');
        res.json(data);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// POST /api/ru-proxy/domains — добавить домен
app.post('/api/ru-proxy/domains', requireAuth, async (req, res) => {
    try {
        const { domain, backend } = req.body;
        if (!domain) return res.status(400).json({ error: 'Домен обязателен' });
        const data = await ruProxyApi('post', '/api/domains', {
            domain: sanitizeString(domain),
            backend: backend ? sanitizeString(backend) : undefined
        });
        res.json(data);
    } catch (error) {
        const status = error.response?.status || 500;
        const msg = error.response?.data?.error || error.message;
        res.status(status).json({ error: msg });
    }
});

// PUT /api/ru-proxy/domains/:domain — обновить домен (enable/disable, backend)
app.put('/api/ru-proxy/domains/:domain', requireAuth, async (req, res) => {
    try {
        const data = await ruProxyApi('put', `/api/domains/${encodeURIComponent(req.params.domain)}`, req.body);
        res.json(data);
    } catch (error) {
        const status = error.response?.status || 500;
        const msg = error.response?.data?.error || error.message;
        res.status(status).json({ error: msg });
    }
});

// DELETE /api/ru-proxy/domains/:domain — удалить домен
app.delete('/api/ru-proxy/domains/:domain', requireAuth, async (req, res) => {
    try {
        const data = await ruProxyApi('delete', `/api/domains/${encodeURIComponent(req.params.domain)}`);
        res.json(data);
    } catch (error) {
        const status = error.response?.status || 500;
        const msg = error.response?.data?.error || error.message;
        res.status(status).json({ error: msg });
    }
});

// POST /api/ru-proxy/reload — принудительная перезагрузка Caddy
app.post('/api/ru-proxy/reload', requireAuth, async (req, res) => {
    try {
        const data = await ruProxyApi('post', '/api/reload');
        res.json(data);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// ==================== File Server API ====================

const FILES_ROOT = '/srv/files';

// Защита от path traversal — резолвит путь и проверяет что внутри FILES_ROOT
function safePath(userPath) {
    const resolved = path.resolve(FILES_ROOT, userPath || '');
    if (!resolved.startsWith(FILES_ROOT)) return null;
    return resolved;
}

// multer для загрузки файлов (лимит 10 GB, хранение во временной папке)
const upload = multer({
    dest: '/tmp/fileserver-uploads',
    limits: { fileSize: 10 * 1024 * 1024 * 1024 }
});

// GET /api/files/status — статус контейнера + диск
app.get('/api/files/status', requireAuth, async (req, res) => {
    try {
        let isRunning = false;
        try {
            const output = execSync('docker ps --filter name=fileserver --format "{{.Names}}"', {
                encoding: 'utf8', stdio: 'pipe'
            }).trim();
            isRunning = output === 'fileserver';
        } catch (e) {
            isRunning = false;
        }

        let healthy = false;
        if (isRunning) {
            try {
                const resp = await axios.get(`http://127.0.0.1:${installConfig.files_port || 3002}/health`, { timeout: 3000 });
                healthy = resp.status === 200;
            } catch (e) {
                healthy = false;
            }
        }

        // Информация о диске
        let disk = { total: 0, used: 0, available: 0, percent: 0 };
        try {
            const dfOut = execSync(`df -B1 ${FILES_ROOT} 2>/dev/null | tail -1`, {
                encoding: 'utf8', stdio: 'pipe'
            }).trim();
            const parts = dfOut.split(/\s+/);
            if (parts.length >= 5) {
                disk.total = parseInt(parts[1]) || 0;
                disk.used = parseInt(parts[2]) || 0;
                disk.available = parseInt(parts[3]) || 0;
                disk.percent = parseInt(parts[4]) || 0;
            }
        } catch (e) {}

        const prefix = installConfig.files_prefix || 'files';
        const middle = installConfig.files_middle || 'dev';
        const domains = buildAllDomains(`${prefix}.${middle}`);

        res.json({
            installed: isRunning,
            running: healthy,
            domains: domains ? domains.split(',') : [],
            port: installConfig.files_port || 3002,
            disk
        });
    } catch (error) {
        res.status(500).json({ installed: false, running: false, error: error.message });
    }
});

// GET /api/files/browse?path=/ — листинг файлов
app.get('/api/files/browse', requireAuth, async (req, res) => {
    try {
        const dirPath = safePath(req.query.path || '/');
        if (!dirPath) return res.status(400).json({ error: 'Недопустимый путь' });
        if (!await fs.pathExists(dirPath)) return res.status(404).json({ error: 'Директория не найдена' });

        const stat = await fs.stat(dirPath);
        if (!stat.isDirectory()) return res.status(400).json({ error: 'Путь не является директорией' });

        const entries = await fs.readdir(dirPath);
        const items = [];
        for (const name of entries) {
            if (name.startsWith('.')) continue;
            try {
                const fullPath = path.join(dirPath, name);
                const s = await fs.stat(fullPath);
                items.push({
                    name,
                    type: s.isDirectory() ? 'directory' : 'file',
                    size: s.isDirectory() ? 0 : s.size,
                    modified: s.mtime.toISOString()
                });
            } catch (e) {}
        }

        // Сортировка: папки первые, потом файлы, по имени
        items.sort((a, b) => {
            if (a.type !== b.type) return a.type === 'directory' ? -1 : 1;
            return a.name.localeCompare(b.name);
        });

        const relativePath = path.relative(FILES_ROOT, dirPath) || '/';
        res.json({ path: '/' + relativePath.replace(/\\/g, '/').replace(/^\/$/, ''), items });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// POST /api/files/upload?path=/ — загрузка файла (multipart)
app.post('/api/files/upload', requireAuth, upload.single('file'), async (req, res) => {
    try {
        if (!req.file) return res.status(400).json({ error: 'Файл не получен' });

        const destDir = safePath(req.body.path || '/');
        if (!destDir) {
            await fs.remove(req.file.path);
            return res.status(400).json({ error: 'Недопустимый путь' });
        }

        if (!await fs.pathExists(destDir)) {
            await fs.remove(req.file.path);
            return res.status(404).json({ error: 'Директория не найдена' });
        }

        const destFile = path.join(destDir, req.file.originalname);
        // Проверка что итоговый путь внутри FILES_ROOT
        if (!destFile.startsWith(FILES_ROOT)) {
            await fs.remove(req.file.path);
            return res.status(400).json({ error: 'Недопустимое имя файла' });
        }

        await fs.move(req.file.path, destFile, { overwrite: true });
        res.json({ ok: true, name: req.file.originalname, size: req.file.size });
    } catch (error) {
        if (req.file) await fs.remove(req.file.path).catch(() => {});
        res.status(500).json({ error: error.message });
    }
});

// DELETE /api/files/delete — удалить файл или папку
app.delete('/api/files/delete', requireAuth, async (req, res) => {
    try {
        const targetPath = safePath(req.body.path);
        if (!targetPath) return res.status(400).json({ error: 'Недопустимый путь' });
        if (targetPath === FILES_ROOT) return res.status(400).json({ error: 'Нельзя удалить корневую директорию' });
        if (!await fs.pathExists(targetPath)) return res.status(404).json({ error: 'Файл не найден' });

        await fs.remove(targetPath);
        res.json({ ok: true });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// POST /api/files/mkdir — создать папку
app.post('/api/files/mkdir', requireAuth, async (req, res) => {
    try {
        const dirPath = safePath(req.body.path);
        if (!dirPath) return res.status(400).json({ error: 'Недопустимый путь' });
        if (await fs.pathExists(dirPath)) return res.status(409).json({ error: 'Директория уже существует' });

        await fs.mkdirp(dirPath);
        res.json({ ok: true });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// POST /api/files/rename — переименовать файл/папку
app.post('/api/files/rename', requireAuth, async (req, res) => {
    try {
        const fromPath = safePath(req.body.from);
        const toPath = safePath(req.body.to);
        if (!fromPath || !toPath) return res.status(400).json({ error: 'Недопустимый путь' });
        if (!await fs.pathExists(fromPath)) return res.status(404).json({ error: 'Исходный файл не найден' });
        if (await fs.pathExists(toPath)) return res.status(409).json({ error: 'Целевой путь уже существует' });

        await fs.move(fromPath, toPath);
        res.json({ ok: true });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// Главная страница (авторизация на уровне Traefik/Authelia)
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// Запуск сервера
app.listen(PORT, () => {
    console.log(`Management UI запущен на порту ${PORT}`);
    console.log(`Откройте http://localhost:${PORT} в браузере`);
});
