# Скрипты установки на одну машину

## Особенности

Все скрипты в этой директории **независимы от текущей директории** - их можно запускать из любого места.

### Автоматическое определение расположения

Каждый скрипт автоматически определяет свое расположение с помощью:
```bash
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
```

Это означает, что:
- Скрипты можно запускать из любой директории
- Все пути к другим скриптам и файлам используют абсолютные пути
- Не нужно находиться в директории со скриптами для их запуска

### Примеры использования

```bash
# Запуск из директории со скриптами
cd ~/install/scripts/single-machine
sudo ./install-all.sh

# Запуск из другой директории (абсолютный путь)
cd /tmp
sudo ~/install/scripts/single-machine/install-all.sh

# Запуск из другой директории (относительный путь)
cd /home/user
sudo ../install/scripts/single-machine/install-all.sh
```

### Структура путей

Скрипты ожидают следующую структуру:
```
~/install/
├── scripts/
│   └── single-machine/
│       ├── install-all.sh
│       ├── install-traefik.sh
│       ├── install-gitlab.sh
│       ├── install-n8n.sh
│       ├── install-management-ui.sh
│       ├── setup-dns-api.sh
│       └── configure-traefik.sh
└── management-ui/
    ├── server.js
    ├── package.json
    └── public/
```

### Поиск management-ui

Скрипт `install-management-ui.sh` автоматически ищет директорию `management-ui` в корневой директории проекта (на один уровень выше `scripts/single-machine`).

Если `management-ui` находится в другом месте, можно указать путь:
```bash
sudo ./install-management-ui.sh /custom/path/to/project/root
```
