#!/usr/bin/env node
// Локальный DNS API сервер для управления поддоменами
// Использование: node local-dns-api-server.js

const express = require('express');
const fs = require('fs-extra');
const path = require('path');
const { v4: uuidv4 } = require('uuid');
const { execSync } = require('child_process');

const app = express();
const PORT = 5353;
const RECORDS_FILE = '/etc/dns-api/records.json';
const DNSMASQ_CONFIG = '/etc/dnsmasq.d/local-domains.conf';
const UPDATE_DNSMASQ_SCRIPT = '/usr/local/bin/update-dnsmasq.sh';

app.use(express.json());

// Создание файла записей если не существует
async function ensureRecordsFile() {
    try {
        await fs.ensureDir(path.dirname(RECORDS_FILE));
        if (!await fs.pathExists(RECORDS_FILE)) {
            await fs.writeJson(RECORDS_FILE, { records: [] }, { mode: 0o600 });
        }
    } catch (error) {
        console.error('Ошибка создания файла записей:', error.message);
    }
}

// Загрузка записей
async function loadRecords() {
    try {
        if (await fs.pathExists(RECORDS_FILE)) {
            const data = await fs.readJson(RECORDS_FILE);
            return data.records || [];
        }
        return [];
    } catch (error) {
        console.error('Ошибка загрузки записей:', error.message);
        return [];
    }
}

// Сохранение записей
async function saveRecords(records) {
    try {
        await fs.writeJson(RECORDS_FILE, { records }, { mode: 0o600 });
        return true;
    } catch (error) {
        console.error('Ошибка сохранения записей:', error.message);
        return false;
    }
}

// Обновление конфигурации dnsmasq
async function updateDnsmasq(records) {
    try {
        if (!await fs.pathExists(UPDATE_DNSMASQ_SCRIPT)) {
            console.warn('Скрипт update-dnsmasq.sh не найден, пропускаем обновление dnsmasq');
            return;
        }
        
        execSync(UPDATE_DNSMASQ_SCRIPT, { stdio: 'inherit' });
    } catch (error) {
        console.warn('Ошибка обновления dnsmasq:', error.message);
    }
}

// GET /api/records - список всех записей
app.get('/api/records', async (req, res) => {
    try {
        const records = await loadRecords();
        res.json({ records });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// GET /api/records/:id - получить запись по ID
app.get('/api/records/:id', async (req, res) => {
    try {
        const records = await loadRecords();
        const record = records.find(r => r.id === req.params.id);
        
        if (!record) {
            return res.status(404).json({ error: 'Запись не найдена' });
        }
        
        res.json({ record });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// POST /api/records - создать запись
app.post('/api/records', async (req, res) => {
    try {
        const { subdomain, domain, ip, type = 'A', ttl = 300 } = req.body;
        
        if (!subdomain || !domain || !ip) {
            return res.status(400).json({ error: 'Необходимы параметры: subdomain, domain, ip' });
        }
        
        const records = await loadRecords();
        
        // Проверка существования записи
        const existing = records.find(r => 
            r.subdomain === subdomain && r.domain === domain
        );
        
        if (existing) {
            // Обновление существующей записи
            existing.ip = ip;
            existing.type = type;
            existing.ttl = ttl;
            existing.updated_at = new Date().toISOString();
            
            await saveRecords(records);
            await updateDnsmasq(records);
            
            return res.json({ 
                record: existing,
                message: 'Запись обновлена'
            });
        }
        
        // Создание новой записи
        const newRecord = {
            id: uuidv4(),
            subdomain,
            domain,
            full_domain: `${subdomain}.${domain}`,
            ip,
            type,
            ttl,
            created_at: new Date().toISOString(),
            updated_at: new Date().toISOString()
        };
        
        records.push(newRecord);
        await saveRecords(records);
        await updateDnsmasq(records);
        
        res.status(201).json({ 
            record: newRecord,
            message: 'Запись создана'
        });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// POST /api/records/bulk - создать или обновить несколько записей
app.post('/api/records/bulk', async (req, res) => {
    try {
        const { records: inputRecords } = req.body;
        if (!Array.isArray(inputRecords) || inputRecords.length === 0) {
            return res.status(400).json({ error: 'Необходим массив records: [{ subdomain, domain, ip }, ...]' });
        }

        const records = await loadRecords();
        const created = [];

        for (const { subdomain, domain, ip, type = 'A', ttl = 300 } of inputRecords) {
            if (!subdomain || !domain || !ip) continue;

            const existingIndex = records.findIndex(r =>
                r.subdomain === subdomain && r.domain === domain
            );

            if (existingIndex >= 0) {
                records[existingIndex].ip = ip;
                records[existingIndex].type = type;
                records[existingIndex].ttl = ttl;
                records[existingIndex].updated_at = new Date().toISOString();
                created.push(records[existingIndex]);
            } else {
                const newRecord = {
                    id: uuidv4(),
                    subdomain,
                    domain,
                    full_domain: `${subdomain}.${domain}`,
                    ip,
                    type,
                    ttl,
                    created_at: new Date().toISOString(),
                    updated_at: new Date().toISOString()
                };
                records.push(newRecord);
                created.push(newRecord);
            }
        }

        await saveRecords(records);
        await updateDnsmasq(records);

        res.status(201).json({
            records: created,
            message: `Обработано записей: ${created.length}`
        });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// PUT /api/records/:id - обновить запись
app.put('/api/records/:id', async (req, res) => {
    try {
        const records = await loadRecords();
        const index = records.findIndex(r => r.id === req.params.id);
        
        if (index === -1) {
            return res.status(404).json({ error: 'Запись не найдена' });
        }
        
        const { subdomain, domain, ip, type, ttl } = req.body;
        
        if (subdomain) records[index].subdomain = subdomain;
        if (domain) records[index].domain = domain;
        if (ip) records[index].ip = ip;
        if (type) records[index].type = type;
        if (ttl) records[index].ttl = ttl;
        
        records[index].full_domain = `${records[index].subdomain}.${records[index].domain}`;
        records[index].updated_at = new Date().toISOString();
        
        await saveRecords(records);
        await updateDnsmasq(records);
        
        res.json({ 
            record: records[index],
            message: 'Запись обновлена'
        });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// DELETE /api/records/:id - удалить запись
app.delete('/api/records/:id', async (req, res) => {
    try {
        const records = await loadRecords();
        const index = records.findIndex(r => r.id === req.params.id);
        
        if (index === -1) {
            return res.status(404).json({ error: 'Запись не найдена' });
        }
        
        const deleted = records.splice(index, 1)[0];
        await saveRecords(records);
        await updateDnsmasq(records);
        
        res.json({ 
            message: 'Запись удалена',
            record: deleted
        });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// DELETE /api/records/subdomain/:subdomain - удалить запись по поддомену
app.delete('/api/records/subdomain/:subdomain', async (req, res) => {
    try {
        const records = await loadRecords();
        const index = records.findIndex(r => r.subdomain === req.params.subdomain);
        
        if (index === -1) {
            return res.status(404).json({ error: 'Запись не найдена' });
        }
        
        const deleted = records.splice(index, 1)[0];
        await saveRecords(records);
        await updateDnsmasq(records);
        
        res.json({ 
            message: 'Запись удалена',
            record: deleted
        });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// GET /api/health - проверка работоспособности
app.get('/api/health', (req, res) => {
    res.json({ 
        status: 'ok',
        timestamp: new Date().toISOString()
    });
});

// Инициализация при запуске
ensureRecordsFile().then(() => {
    app.listen(PORT, '127.0.0.1', () => {
        console.log(`Локальный DNS API сервер запущен на порту ${PORT}`);
        console.log(`Файл записей: ${RECORDS_FILE}`);
    });
}).catch(error => {
    console.error('Ошибка инициализации:', error);
    process.exit(1);
});
