// Реестр управляемых серверов (multi-server)
// Источник: /etc/management-ui/servers.json
// Аутентификация в node-agent — через mTLS-cert от step-ca

export interface ServerRecord {
  name: string;                  // уникальный slug, "contabo-sm-139"
  role: 'primary' | 'secondary'; // primary хостит step-ca + management-ui
  ssh_host: string;              // IPv4 или DNS-имя
  agent_url: string;             // https://agent-<name>.internal:7180 или https://agent.<server>.tunnel.borisovai.ru
  agent_san: string;             // SAN агента, "agent-<name>.internal" — для проверки серверного cert'а
  base_domains: string[];        // обслуживаемые этим сервером домены
  config_dir: string;            // путь в server-configs репе, "servers/<name>"
  enabled: boolean;
  tags: string[];
  created_at?: string;
  updated_at?: string;
}

export interface ServerHealthSnapshot {
  reachable: boolean;
  agent_version?: string;
  agent_uptime_seconds?: number;
  cert_expiry_days?: number | null;
  enabled_checkers?: string[];
  error?: string;
  checked_at: string;
}

export interface CreateServerRequest {
  name: string;
  role: 'primary' | 'secondary';
  ssh_host: string;
  agent_url: string;
  agent_san: string;
  base_domains?: string[];
  config_dir?: string;
  tags?: string[];
}

export interface UpdateServerRequest {
  role?: 'primary' | 'secondary';
  ssh_host?: string;
  agent_url?: string;
  agent_san?: string;
  base_domains?: string[];
  config_dir?: string;
  enabled?: boolean;
  tags?: string[];
}

export interface CreateServerResponse {
  server: ServerRecord;
  bootstrap_token: string;        // одноразовый JWK от step-ca, TTL 1h, показывается ОДИН раз
  bootstrap_command: string;      // готовая команда для запуска install-node-agent.sh на secondary
  ca_url: string;
  ca_root_fingerprint: string;
  intermediate_pem: string;       // intermediate cert для bundle (агент должен отдавать leaf+intermediate)
}
