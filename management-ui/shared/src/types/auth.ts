export interface AuthToken {
  id: string;
  name: string;
  tokenPrefix: string;
  createdAt: string;
}

export interface AuthTokenWithHash extends AuthToken {
  tokenHash: string;
}

export interface CreateTokenRequest {
  name: string;
}

export interface CreateTokenResponse {
  id: string;
  name: string;
  token: string;
  createdAt: string;
}

export interface AuthCheckResponse {
  authenticated: boolean;
  method?: 'authelia' | 'bearer';
  user?: string;
}
