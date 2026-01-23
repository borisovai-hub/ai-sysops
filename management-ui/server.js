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
app.use(express.static(path.join(__dirname, 'public')));

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

// Загрузка DNS конфигурации
let dnsConfig = {};
try {
    if (fs.existsSync(DNS_CONFIG_FILE)) {
        dnsConfig = fs.readJsonSync(DNS_CONFIG_FILE);
    }
} catch (error) {
    console.warn('DNS конфигурация не найдена');
}

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
                        const hostMatch = router.rule.match(/Host\(`(.+)`\)/);
                        const domain = hostMatch ? hostMatch[1] : '';
                        const server = service.loadBalancer.servers[0];
                        const urlMatch = server.url.match(/http:\/\/(.+):(\d+)/);
                        
                        services.push({
                            name: file.replace('.yml', ''),
                            domain: domain,
                            internalIp: urlMatch ? urlMatch[1] : '',
                            port: urlMatch ? urlMatch[2] : '',
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
        const { name, internalIp, port, domain } = req.body;
        
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
        
        // Получение внешнего IP
        let externalIp;
        try {
            const response = await axios.get('https://api.ipify.org?format=json', { timeout: 5000 });
            externalIp = response.data.ip;
        } catch (error) {
            externalIp = '127.0.0.1'; // Fallback
        }
        
        // Создание DNS записи
        if (dnsConfig.provider) {
            try {
                execSync(`manage-dns create ${name} ${externalIp}`, { stdio: 'inherit' });
            } catch (error) {
                console.warn('Ошибка создания DNS записи:', error.message);
            }
        }
        
        // Создание конфигурации Traefik
        const configContent = {
            http: {
                routers: {
                    [name]: {
                        rule: `Host(\`${serviceDomain}\`)`,
                        service: name,
                        entryPoints: ['websecure'],
                        tls: {
                            certResolver: 'letsencrypt'
                        }
                    }
                },
                services: {
                    [name]: {
                        loadBalancer: {
                            servers: [
                                { url: `http://${internalIp}:${port}` }
                            ]
                        }
                    }
                }
            }
        };
        
        const configPath = path.join(TRAEFIK_DYNAMIC_DIR, `${name}.yml`);
        await fs.writeFile(configPath, yaml.stringify(configContent));
        
        // Перезагрузка Traefik
        try {
            execSync('systemctl reload traefik', { stdio: 'inherit' });
        } catch (error) {
            console.warn('Ошибка перезагрузки Traefik:', error.message);
        }
        
        res.json({ 
            success: true, 
            message: 'Сервис создан успешно',
            service: {
                name,
                domain: serviceDomain,
                internalIp,
                port
            }
        });
    } catch (error) {
        console.error('Ошибка создания сервиса:', error);
        res.status(500).json({ error: error.message });
    }
});

// API: Удаление сервиса
app.delete('/api/services/:name', requireAuth, async (req, res) => {
    try {
        const { name } = req.params;
        const configPath = path.join(TRAEFIK_DYNAMIC_DIR, `${name}.yml`);
        
        if (await fs.pathExists(configPath)) {
            await fs.remove(configPath);
            
            // Удаление DNS записи
            if (dnsConfig.provider) {
                try {
                    execSync(`manage-dns delete ${name}`, { stdio: 'inherit' });
                } catch (error) {
                    console.warn('Ошибка удаления DNS записи:', error.message);
                }
            }
            
            // Перезагрузка Traefik
            try {
                execSync('systemctl reload traefik', { stdio: 'inherit' });
            } catch (error) {
                console.warn('Ошибка перезагрузки Traefik:', error.message);
            }
            
            res.json({ success: true, message: 'Сервис удален' });
        } else {
            res.status(404).json({ error: 'Сервис не найден' });
        }
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

// Главная страница (требует авторизации)
app.get('/', requireAuth, (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// Запуск сервера
app.listen(PORT, () => {
    console.log(`Management UI запущен на порту ${PORT}`);
    console.log(`Откройте http://localhost:${PORT} в браузере`);
});
