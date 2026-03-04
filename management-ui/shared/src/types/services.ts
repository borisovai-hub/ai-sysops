export interface Service {
  id: number;
  name: string;
  domain: string;
  internalIp: string;
  port: number;
  configFile: string;
  routerName: string | null;
  hasAuthelia: boolean;
  isSystemService: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface CreateServiceRequest {
  name: string;
  domain: string;
  ip?: string;
  port: number;
  authelia?: boolean;
}

export interface UpdateServiceRequest {
  domain?: string;
  ip?: string;
  port?: number;
  authelia?: boolean;
}

export interface TraefikStatus {
  running: boolean;
  version?: string;
  providers?: string[];
}
