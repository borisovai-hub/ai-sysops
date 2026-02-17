const express = require('express');
const fs = require('fs-extra');
const path = require('path');
const { execSync } = require('child_process');
const crypto = require('crypto');

const app = express();
const PORT = process.env.PORT || 3100;
const DOMAINS_FILE = process.env.DOMAINS_FILE || '/etc/ru-proxy/domains.json';
const CADDYFILE_PATH = process.env.CADDYFILE_PATH || '/etc/caddy/Caddyfile';
const AUTH_TOKEN_FILE = process.env.AUTH_TOKEN_FILE || '/etc/ru-proxy/auth-token';
const CONFIG_FILE = process.env.CONFIG_FILE || '/etc/ru-proxy/config.json';

app.use(express.json());

// --- Конфигурация ---

let config = {};
try {
    if (fs.existsSync(CONFIG_FILE)) {
        config = fs.readJsonSync(CONFIG_FILE);
    }
} catch (err) {
    console.error('Ошибка загрузки конфигурации:', err.message);
}

// --- Авторизация (Bearer token, timing-safe) ---

let authToken = '';
try {
    if (fs.existsSync(AUTH_TOKEN_FILE)) {
        authToken = fs.readFileSync(AUTH_TOKEN_FILE, 'utf8').trim();
    }
} catch (err) {
    console.error('Ошибка загрузки auth-token:', err.message);
}

function requireAuth(req, res, next) {
    const header = req.headers.authorization;
    if (!header || !header.startsWith('Bearer ')) {
        return res.status(401).json({ error: 'Требуется авторизация (Bearer token)' });
    }
    const token = header.slice(7);
    if (!authToken || !token) {
        return res.status(401).json({ error: 'Токен не настроен' });
    }
    const tokenBuf = Buffer.from(token);
    const storedBuf = Buffer.from(authToken);
    if (tokenBuf.length !== storedBuf.length || !crypto.timingSafeEqual(tokenBuf, storedBuf)) {
        return res.status(401).json({ error: 'Недействительный токен' });
    }
    next();
}

// --- Домены (CRUD) ---

function loadDomains() {
    try {
        if (fs.existsSync(DOMAINS_FILE)) {
            return fs.readJsonSync(DOMAINS_FILE);
        }
    } catch (err) {
        console.error('Ошибка чтения domains.json:', err.message);
    }
    return { defaultBackend: '', domains: [] };
}

function saveDomains(data) {
    fs.ensureDirSync(path.dirname(DOMAINS_FILE));
    fs.writeJsonSync(DOMAINS_FILE, data, { spaces: 2 });
}

// --- Caddyfile генерация ---

function generateCaddyfile(domainsData) {
    const lines = [
        '{',
        '    admin localhost:2019',
        '}',
        ''
    ];

    for (const entry of domainsData.domains) {
        if (!entry.enabled) continue;
        const backend = entry.backend || domainsData.defaultBackend;
        if (!backend) continue;

        lines.push(`${entry.domain} {`);
        lines.push(`    reverse_proxy ${backend} {`);
        lines.push(`        header_up Host {host}`);
        lines.push(`        header_up X-Real-IP {remote_host}`);

        // TLS к бэкенду: SNI = домен, чтобы Traefik маршрутизировал правильно
        if (backend.startsWith('https://')) {
            lines.push(`        transport http {`);
            lines.push(`            tls_server_name ${entry.domain}`);
            lines.push(`        }`);
        }

        lines.push(`    }`);
        lines.push(`}`);
        lines.push('');
    }

    return lines.join('\n');
}

function writeCaddyfile(domainsData) {
    const content = generateCaddyfile(domainsData);
    fs.ensureDirSync(path.dirname(CADDYFILE_PATH));
    fs.writeFileSync(CADDYFILE_PATH, content, 'utf8');
    return content;
}

function reloadCaddy() {
    try {
        execSync(`caddy reload --config ${CADDYFILE_PATH}`, {
            timeout: 15000,
            stdio: 'pipe'
        });
        return { ok: true };
    } catch (err) {
        // Если reload не работает (Caddy не запущен), пробуем через systemctl
        try {
            execSync('systemctl reload caddy', { timeout: 15000, stdio: 'pipe' });
            return { ok: true };
        } catch (err2) {
            return { ok: false, error: err2.message };
        }
    }
}

function isCaddyRunning() {
    try {
        const result = execSync('systemctl is-active caddy', { encoding: 'utf8', stdio: 'pipe' }).trim();
        return result === 'active';
    } catch {
        return false;
    }
}

// --- API Endpoints ---

// Health check (без авторизации)
app.get('/api/health', (req, res) => {
    const domainsData = loadDomains();
    const caddy = isCaddyRunning();
    res.json({
        ok: true,
        caddy,
        uptime: process.uptime(),
        domains_count: domainsData.domains.filter(d => d.enabled).length,
        total_domains: domainsData.domains.length
    });
});

// Список доменов
app.get('/api/domains', requireAuth, (req, res) => {
    const data = loadDomains();
    res.json(data);
});

// Добавить домен
app.post('/api/domains', requireAuth, (req, res) => {
    const { domain, backend } = req.body;
    if (!domain || typeof domain !== 'string') {
        return res.status(400).json({ error: 'Поле domain обязательно' });
    }

    const cleanDomain = domain.trim().toLowerCase().replace(/[^a-z0-9.\-*]/g, '');
    if (!cleanDomain) {
        return res.status(400).json({ error: 'Некорректный домен' });
    }

    const data = loadDomains();

    // Проверка дублей
    if (data.domains.some(d => d.domain === cleanDomain)) {
        return res.status(409).json({ error: `Домен ${cleanDomain} уже добавлен` });
    }

    data.domains.push({
        domain: cleanDomain,
        backend: backend || data.defaultBackend || '',
        enabled: true,
        addedAt: new Date().toISOString()
    });

    saveDomains(data);
    writeCaddyfile(data);
    const reloadResult = reloadCaddy();

    res.json({ ok: true, domain: cleanDomain, caddy_reload: reloadResult });
});

// Удалить домен
app.delete('/api/domains/:domain', requireAuth, (req, res) => {
    const targetDomain = decodeURIComponent(req.params.domain).trim().toLowerCase();
    const data = loadDomains();

    const idx = data.domains.findIndex(d => d.domain === targetDomain);
    if (idx === -1) {
        return res.status(404).json({ error: `Домен ${targetDomain} не найден` });
    }

    data.domains.splice(idx, 1);
    saveDomains(data);
    writeCaddyfile(data);
    const reloadResult = reloadCaddy();

    res.json({ ok: true, removed: targetDomain, caddy_reload: reloadResult });
});

// Обновить домен (enable/disable, backend)
app.put('/api/domains/:domain', requireAuth, (req, res) => {
    const targetDomain = decodeURIComponent(req.params.domain).trim().toLowerCase();
    const data = loadDomains();

    const entry = data.domains.find(d => d.domain === targetDomain);
    if (!entry) {
        return res.status(404).json({ error: `Домен ${targetDomain} не найден` });
    }

    if (typeof req.body.enabled === 'boolean') {
        entry.enabled = req.body.enabled;
    }
    if (req.body.backend && typeof req.body.backend === 'string') {
        entry.backend = req.body.backend.trim();
    }

    saveDomains(data);
    writeCaddyfile(data);
    const reloadResult = reloadCaddy();

    res.json({ ok: true, domain: targetDomain, entry, caddy_reload: reloadResult });
});

// Статус Caddy (детальный)
app.get('/api/status', requireAuth, async (req, res) => {
    const caddy = isCaddyRunning();
    const data = loadDomains();

    let caddyConfig = null;
    if (caddy) {
        try {
            // Caddy admin API
            const http = require('http');
            const resp = await new Promise((resolve, reject) => {
                http.get('http://127.0.0.1:2019/config/', (r) => {
                    let body = '';
                    r.on('data', chunk => body += chunk);
                    r.on('end', () => resolve(body));
                }).on('error', reject);
            });
            caddyConfig = JSON.parse(resp);
        } catch {
            caddyConfig = null;
        }
    }

    res.json({
        caddy_running: caddy,
        domains: data.domains,
        defaultBackend: data.defaultBackend,
        caddyfile_path: CADDYFILE_PATH,
        caddy_config: caddyConfig ? 'loaded' : 'unavailable'
    });
});

// Принудительная перегенерация и перезагрузка
app.post('/api/reload', requireAuth, (req, res) => {
    const data = loadDomains();
    writeCaddyfile(data);
    const reloadResult = reloadCaddy();
    res.json({ ok: true, caddy_reload: reloadResult, domains_count: data.domains.filter(d => d.enabled).length });
});

// --- Запуск ---

app.listen(PORT, '0.0.0.0', () => {
    const data = loadDomains();
    console.log(`ru-proxy-api запущен на порту ${PORT}`);
    console.log(`Доменов: ${data.domains.length} (активных: ${data.domains.filter(d => d.enabled).length})`);
    console.log(`Caddyfile: ${CADDYFILE_PATH}`);
});
