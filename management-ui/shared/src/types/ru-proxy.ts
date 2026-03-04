export interface RuProxyDomain {
  domain: string;
  backend: string;
  enabled: boolean;
}

export interface RuProxyStatus {
  running: boolean;
  version?: string;
  domains?: number;
}

export interface AddDomainRequest {
  domain: string;
  backend?: string;
}

export interface UpdateDomainRequest {
  backend?: string;
  enabled?: boolean;
}
