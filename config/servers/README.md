# Конфигурация серверов

Каждый каталог `config/servers/<id>/` описывает один хост (сервер).
Именование: `<хостер>-<тип>-<IP>`, например `contabo-sm-139`.

## Структура

```
config/servers/
├── contabo-sm-139/     # Contabo Single Machine (144.91.108.139)
│   └── env.yml         # Переменные: SSH, IP, runner_tag, base_domain, порты
└── README.md
```

Конфиги каждого сервера хранятся в `config/<id>/`:

```
config/contabo-sm-139/
├── traefik/
│   ├── traefik.yml             # Статический конфиг Traefik
│   └── dynamic/                # Динамические конфиги (роутеры сервисов)
├── systemd/                    # Unit-файлы systemd
├── mailu/                      # Docker Compose + env для Mailu
├── gitlab/                     # gitlab.rb
└── install-config.json.example # Конфигурация установки
```

## Поля env.yml

| Поле | Описание |
|------|----------|
| `ssh_host` | IP или hostname для SSH-подключения |
| `ssh_user` | SSH-пользователь (обычно root) |
| `internal_ip` | Внутренний IP для Traefik backend |
| `runner_tag` | Тег GitLab Runner на этом сервере |
| `base_domain` | Базовый домен для поддоменов проектов |
| `management_ui_port` | Порт Management UI |
| `dns_api_port` | Порт DNS API |
| `traefik_dashboard_port` | Порт дашборда Traefik |
| `deploy_base_path` | Базовый путь для деплоя приложений |
| `traefik_dynamic_dir` | Путь к динамическим конфигам Traefik |
| `config_dir` | Путь к конфигам этого сервера в Git |

## Добавление нового сервера

1. Создать каталог `config/servers/<id>/` с `env.yml` (включая `ssh_host`, `ssh_user`)
2. Создать каталог `config/<id>/` с конфигами сервера (traefik, systemd, mailu и т.д.)
3. На новом сервере установить GitLab Runner с уникальным тегом
4. Зарегистрировать Runner в GitLab (Settings → CI/CD → Runners)
5. Скрипт `upload-single-machine.sh` автоматически найдёт сервер при запуске

Подробнее: [docs/plans/TZ_ONE_CLICK_PUBLISH.md](../../docs/plans/TZ_ONE_CLICK_PUBLISH.md) — Фаза 2.
