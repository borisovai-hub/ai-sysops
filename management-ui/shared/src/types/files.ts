export interface FileEntry {
  name: string;
  path: string;
  type: 'file' | 'directory';
  size: number;
  modified: string;
}

export interface FileStatus {
  running: boolean;
  rootPath?: string;
  totalSize?: string;
}

export interface CreateDirRequest {
  path: string;
}

export interface RenameRequest {
  oldPath: string;
  newPath: string;
}
