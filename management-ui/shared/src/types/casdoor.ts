export interface CasdoorStatus {
  status: 'running' | 'stopped' | 'degraded';
  installed: boolean;
  running: boolean;
  domain: string;
  port: number;
}
