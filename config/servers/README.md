# Конфигурация серверов

Каждый каталог `config/servers/<id>/` описывает один хост (сервер).

## Структура

```
config/servers/
├── vm1/                # Первый сервер (текущий)
│   └── env.yml         # Переменные: IP, runner_tag, base_domain, порты
├── vm2/                # (Фаза 2) Второй сервер
│   └── env.yml
└── README.md
```

## Поля env.yml

| Поле | Описание |
|------|----------|
| `internal_ip` | Внутренний IP для Traefik backend |
| `runner_tag` | Тег GitLab Runner на этом сервере |
| `base_domain` | Базовый домен для поддоменов проектов |
| `management_ui_port` | Порт Management UI |
| `dns_api_port` | Порт DNS API |
| `deploy_base_path` | Базовый путь для деплоя приложений |
| `traefik_dynamic_dir` | Путь к динамическим конфигам Traefik |

## Добавление нового сервера (Фаза 2)

1. Создать каталог `config/servers/<id>/` с `env.yml`
2. На новом сервере установить GitLab Runner с уникальным тегом
3. Зарегистрировать Runner в GitLab (Settings → CI/CD → Runners)
4. При регистрации проекта через оркестратор — выбрать целевой хост по тегу Runner

Подробнее: [docs/TZ_ONE_CLICK_PUBLISH.md](../../docs/TZ_ONE_CLICK_PUBLISH.md) — Фаза 2.
