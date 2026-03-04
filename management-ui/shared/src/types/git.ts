export interface GitFileStatus {
  path: string;
  index: string;
  working_dir: string;
}

export interface GitStatus {
  current: string | null;
  tracking: string | null;
  ahead: number;
  behind: number;
  files: GitFileStatus[];
  staged: string[];
  modified: string[];
  not_added: string[];
  deleted: string[];
  created: string[];
}

export interface GitLogEntry {
  hash: string;
  date: string;
  message: string;
  author_name: string;
  author_email: string;
}

export interface GitDiffResult {
  file?: string;
  diff: string;
}

export interface CommitRequest {
  files: string[];
  message: string;
}

export interface PushRequest {
  branch?: string;
}

export interface CommitResult {
  hash: string;
  message: string;
  filesChanged: number;
}

export interface PushResult {
  success: boolean;
  branch: string;
  remote: string;
}
