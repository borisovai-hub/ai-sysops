export interface TasksStatus {
  status: 'running' | 'stopped' | 'degraded';
  installed: boolean;
  running: boolean;
  domains: string[];
  port: number;
  config: TasksConfig;
}

export interface TasksConfig {
  prefix: string;
  middle: string;
  port: number;
  frontendUrl: string;
  oidc: TasksOidcConfig;
  smtp: TasksSmtpConfig;
  caldav: TasksCalDavConfig;
}

export interface TasksOidcConfig {
  enabled: boolean;
  provider: string;
  clientId: string;
  issuerUrl: string;
}

export interface TasksSmtpConfig {
  enabled: boolean;
  host: string;
  port: number;
  from: string;
}

export interface TasksCalDavConfig {
  enabled: boolean;
  url: string;
}
