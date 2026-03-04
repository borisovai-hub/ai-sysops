export interface AutheliaUser {
  username: string;
  displayname: string;
  email: string;
  groups: string[];
  disabled: boolean;
  mailbox?: string;
}

export interface CreateUserRequest {
  username: string;
  displayname: string;
  email?: string;
  password: string;
  groups?: string[];
}

export interface UpdateUserRequest {
  displayname?: string;
  email?: string;
  groups?: string[];
  disabled?: boolean;
}

export interface ChangePasswordRequest {
  password: string;
}

export interface NotifierConfig {
  type: 'smtp' | 'filesystem';
  smtp?: {
    host: string;
    port: number;
    sender: string;
  };
}
