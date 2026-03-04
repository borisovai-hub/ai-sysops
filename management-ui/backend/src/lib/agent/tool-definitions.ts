import type { AgentToolDef, ApprovalTier } from '@management-ui/shared';

// --- Tool Definitions ---

export const AGENT_TOOLS: AgentToolDef[] = [
  // --- Read tools (auto) ---
  {
    name: 'shell_exec',
    description: 'Выполнить shell-команду на сервере. Для чтения (ls, cat, docker ps, systemctl status) — auto. Для модификаций — approve.',
    tier: 'approve',
    parameters: [
      { name: 'command', type: 'string', description: 'Shell-команда для выполнения', required: true },
      { name: 'safe', type: 'boolean', description: 'true если команда только читает (ls, cat, ps). false если модифицирует (rm, mv, apt, docker stop)', required: true },
    ],
  },
  {
    name: 'file_read',
    description: 'Прочитать содержимое файла',
    tier: 'auto',
    parameters: [
      { name: 'path', type: 'string', description: 'Абсолютный путь к файлу', required: true },
      { name: 'maxLines', type: 'number', description: 'Макс. кол-во строк (по умолчанию 200)' },
    ],
  },
  {
    name: 'file_write',
    description: 'Записать содержимое в файл (создать или перезаписать)',
    tier: 'approve',
    parameters: [
      { name: 'path', type: 'string', description: 'Абсолютный путь к файлу', required: true },
      { name: 'content', type: 'string', description: 'Содержимое файла', required: true },
    ],
  },
  {
    name: 'file_list',
    description: 'Список файлов и папок в директории',
    tier: 'auto',
    parameters: [
      { name: 'path', type: 'string', description: 'Абсолютный путь к директории', required: true },
    ],
  },
  {
    name: 'file_delete',
    description: 'Удалить файл или директорию',
    tier: 'approve',
    parameters: [
      { name: 'path', type: 'string', description: 'Абсолютный путь', required: true },
    ],
  },
  {
    name: 'file_mkdir',
    description: 'Создать директорию (рекурсивно)',
    tier: 'notify',
    parameters: [
      { name: 'path', type: 'string', description: 'Абсолютный путь к директории', required: true },
    ],
  },
  {
    name: 'services_list',
    description: 'Получить список всех Traefik-сервисов (роутеров)',
    tier: 'auto',
    parameters: [],
  },
  {
    name: 'service_create',
    description: 'Создать новый Traefik-сервис (роутер)',
    tier: 'approve',
    parameters: [
      { name: 'name', type: 'string', description: 'Имя сервиса (slug)', required: true },
      { name: 'domain', type: 'string', description: 'Домен', required: true },
      { name: 'port', type: 'number', description: 'Внутренний порт', required: true },
      { name: 'ip', type: 'string', description: 'Внутренний IP (default: 127.0.0.1)' },
      { name: 'authelia', type: 'boolean', description: 'Включить Authelia middleware' },
    ],
  },
  {
    name: 'service_delete',
    description: 'Удалить Traefik-сервис',
    tier: 'approve',
    parameters: [
      { name: 'name', type: 'string', description: 'Имя сервиса', required: true },
    ],
  },
  {
    name: 'dns_list',
    description: 'Получить список DNS-записей',
    tier: 'auto',
    parameters: [],
  },
  {
    name: 'dns_create',
    description: 'Создать DNS-запись для всех базовых доменов',
    tier: 'approve',
    parameters: [
      { name: 'subdomain', type: 'string', description: 'Поддомен (например analytics.dev)', required: true },
      { name: 'ip', type: 'string', description: 'IP-адрес (если не указан — внешний IP сервера)' },
    ],
  },
  {
    name: 'dns_delete',
    description: 'Удалить DNS-запись по ID',
    tier: 'approve',
    parameters: [
      { name: 'id', type: 'string', description: 'ID записи', required: true },
    ],
  },
  {
    name: 'git_status',
    description: 'Git status репозитория borisovai-admin',
    tier: 'auto',
    parameters: [],
  },
  {
    name: 'git_diff',
    description: 'Git diff (изменения)',
    tier: 'auto',
    parameters: [
      { name: 'staged', type: 'boolean', description: 'Показать staged изменения (--cached)' },
    ],
  },
  {
    name: 'git_log',
    description: 'Git log последних коммитов',
    tier: 'auto',
    parameters: [
      { name: 'count', type: 'number', description: 'Кол-во коммитов (default: 10)' },
    ],
  },
  {
    name: 'git_commit',
    description: 'Создать git коммит',
    tier: 'approve',
    parameters: [
      { name: 'message', type: 'string', description: 'Сообщение коммита', required: true },
      { name: 'files', type: 'string', description: 'Файлы через запятую (если пусто — все staged)', required: false },
    ],
  },
  {
    name: 'git_push',
    description: 'Git push в remote',
    tier: 'approve',
    parameters: [],
  },

  // --- Monitoring tools ---
  {
    name: 'monitoring_status',
    description: 'Статус всех мониторируемых сервисов (latest check)',
    tier: 'auto',
    parameters: [],
  },
  {
    name: 'monitoring_history',
    description: 'История проверок здоровья конкретного сервиса',
    tier: 'auto',
    parameters: [
      { name: 'serviceName', type: 'string', description: 'Имя сервиса', required: true },
      { name: 'hours', type: 'number', description: 'За сколько часов (default: 24)' },
    ],
  },
  {
    name: 'monitoring_uptime',
    description: 'Статистика аптайма сервисов',
    tier: 'auto',
    parameters: [
      { name: 'days', type: 'number', description: 'За сколько дней (default: 7)' },
    ],
  },
  {
    name: 'monitoring_check',
    description: 'Немедленная проверка здоровья (одного или всех сервисов)',
    tier: 'auto',
    parameters: [
      { name: 'serviceName', type: 'string', description: 'Имя сервиса (если пусто — все)' },
    ],
  },
  {
    name: 'security_analyze',
    description: 'Анализ логов Authelia на неудачные входы и brute force',
    tier: 'auto',
    parameters: [
      { name: 'hours', type: 'number', description: 'За сколько часов (default: 6)' },
    ],
  },
  {
    name: 'security_traffic',
    description: 'Анализ трафика Traefik (подозрительные запросы, высокая нагрузка)',
    tier: 'auto',
    parameters: [
      { name: 'minutes', type: 'number', description: 'За сколько минут (default: 60)' },
    ],
  },
  {
    name: 'security_config_scan',
    description: 'Сканирование Traefik-конфигов на отсутствие Authelia middleware',
    tier: 'auto',
    parameters: [],
  },
  {
    name: 'security_events',
    description: 'Список событий безопасности',
    tier: 'auto',
    parameters: [
      { name: 'severity', type: 'string', description: 'Фильтр по severity (low/medium/high/critical)' },
      { name: 'limit', type: 'number', description: 'Макс. кол-во (default: 50)' },
    ],
  },
  {
    name: 'security_block_ip',
    description: 'Заблокировать IP-адрес через iptables',
    tier: 'approve',
    parameters: [
      { name: 'ip', type: 'string', description: 'IP-адрес для блокировки', required: true },
      { name: 'reason', type: 'string', description: 'Причина блокировки', required: true },
    ],
  },
  {
    name: 'service_restart',
    description: 'Перезапустить systemd-сервис',
    tier: 'approve',
    parameters: [
      { name: 'serviceName', type: 'string', description: 'Имя systemd-сервиса', required: true },
    ],
  },
  {
    name: 'alerts_list',
    description: 'Список активных алертов мониторинга',
    tier: 'auto',
    parameters: [
      { name: 'status', type: 'string', description: 'Фильтр по статусу (active/acknowledged/resolved)' },
    ],
  },
  {
    name: 'alerts_acknowledge',
    description: 'Подтвердить (acknowledge) алерт',
    tier: 'notify',
    parameters: [
      { name: 'alertId', type: 'number', description: 'ID алерта', required: true },
    ],
  },
];

// --- Types ---

export type ToolResult = {
  output: string;
  success: boolean;
};

// --- Helpers ---

/**
 * Определить реальный tier для shell_exec на основе аргументов
 */
export function resolveToolTier(toolName: string, args: Record<string, unknown>): ApprovalTier {
  if (toolName === 'shell_exec' && args.safe === true) {
    return 'auto'; // Безопасные команды (ls, cat, ps) не требуют подтверждения
  }
  const def = AGENT_TOOLS.find((t) => t.name === toolName);
  return def?.tier ?? 'approve';
}
