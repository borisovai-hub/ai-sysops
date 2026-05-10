// MonitoringConfig — stored in config_entries table as JSON
export interface MonitoringConfig {
  enabled: boolean;
  healthChecks: {
    enabled: boolean;
    intervalMs: number;
    services: string[];  // empty = all
  };
  security: {
    enabled: boolean;
    authLogIntervalMs: number;
    trafficIntervalMs: number;
    configScanIntervalMs: number;
    bruteForceThreshold: number;
  };
  sse: { enabled: boolean };
  retention: {
    healthCheckDays: number;
    alertDays: number;
    securityEventDays: number;
  };
}

export const DEFAULT_MONITORING_CONFIG: MonitoringConfig = {
  enabled: true,
  healthChecks: { enabled: true, intervalMs: 60000, services: [] },
  security: {
    enabled: true,
    authLogIntervalMs: 300000,
    trafficIntervalMs: 900000,
    configScanIntervalMs: 3600000,
    bruteForceThreshold: 5,
  },
  sse: { enabled: true },
  retention: { healthCheckDays: 30, alertDays: 90, securityEventDays: 90 },
};

export interface CheckResult {
  status: 'up' | 'down' | 'degraded';
  responseTimeMs: number;
  statusCode?: number;
  error?: string;
  details?: Record<string, unknown>;
}

export interface HealthCheckRow {
  id: number;
  serviceName: string;
  status: string;
  responseTimeMs: number | null;
  statusCode: number | null;
  error: string | null;
  details: string | null;
  checkedAt: string;
}

export interface AlertRow {
  id: number;
  severity: string;
  category: string;
  source: string;
  title: string;
  message: string;
  status: string;
  acknowledgedBy: string | null;
  resolvedAt: string | null;
  metadata: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface SecurityEventRow {
  id: number;
  eventType: string;
  severity: string;
  sourceIp: string | null;
  username: string | null;
  serviceName: string | null;
  description: string;
  details: string | null;
  resolved: boolean;
  createdAt: string;
}

// Multi-server monitoring response (Phase 3)
export interface MonitoringStatus {
  enabled: boolean;
  servers: Record<string, Record<string, HealthCheckRow>>;
  activeAlerts: number;
  overallUptime: number;
}

export interface ServiceUptimeStats {
  serviceName: string;
  uptimePercent: number;
  avgResponseMs: number;
  incidents: number;
  lastDown: string | null;
}
