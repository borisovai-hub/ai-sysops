export interface TunnelStatus {
  running: boolean;
  version?: string;
  currentConnections?: number;
  totalTrafficIn?: string;
  totalTrafficOut?: string;
}

export interface TunnelProxy {
  name: string;
  type: string;
  status: string;
  localAddr?: string;
  remoteAddr?: string;
  todayTrafficIn?: number;
  todayTrafficOut?: number;
}

export interface TunnelConfig {
  serverAddr: string;
  serverPort: number;
  token: string;
}
