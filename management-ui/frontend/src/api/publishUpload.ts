import { api, ApiError } from './client';

export interface UploadInitResponse {
  uploadHandle: string;
  chunkSize: number;
  expiresAt: string;
}

export interface UploadCompleteResponse {
  uploadHandle: string;
  storagePath: string;
  downloadUrl: string;
  checksumSha256: string;
  sizeBytes: number;
}

export interface ChunkedUploadInput {
  slug: string;
  file: File;
  version?: string;
  storage?: { kind?: string; visibility?: string; basePath?: string };
  onProgress?: (received: number, total: number) => void;
  signal?: AbortSignal;
}

async function sha256File(file: File): Promise<string> {
  if (!crypto.subtle) return '';
  const buf = await file.arrayBuffer();
  const hash = await crypto.subtle.digest('SHA-256', buf);
  return Array.from(new Uint8Array(hash))
    .map(b => b.toString(16).padStart(2, '0')).join('');
}

async function putChunk(handle: string, offset: number, buf: ArrayBuffer, signal?: AbortSignal): Promise<void> {
  const token = localStorage.getItem('auth_token');
  const headers: Record<string, string> = { 'Content-Type': 'application/octet-stream' };
  if (token) headers.Authorization = `Bearer ${token}`;
  const res = await fetch(`/api/publish/uploads/${handle}/chunk?offset=${offset}`, {
    method: 'PUT',
    headers,
    body: buf,
    signal,
  });
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new ApiError(res.status, `chunk PUT failed: ${text || res.statusText}`);
  }
}

/**
 * Chunked resumable upload. Возвращает финальный handle + downloadUrl.
 * Прогресс эмитируется в байтах.
 */
export async function chunkedUpload(input: ChunkedUploadInput): Promise<UploadCompleteResponse> {
  const { file, slug, version, storage, onProgress, signal } = input;
  const checksum = await sha256File(file);

  const init = await api.post<UploadInitResponse>('/api/publish/uploads/init', {
    slug,
    filename: file.name,
    sizeBytes: file.size,
    contentType: file.type || 'application/octet-stream',
    checksumSha256: checksum || undefined,
    storage: {
      kind: storage?.kind ?? 'downloads',
      visibility: storage?.visibility ?? 'public',
      basePath: storage?.basePath,
    },
    version,
  });

  const chunkSize = init.chunkSize || 8 * 1024 * 1024;
  let offset = 0;
  while (offset < file.size) {
    if (signal?.aborted) throw new Error('Upload отменён');
    const slice = file.slice(offset, offset + chunkSize);
    const buf = await slice.arrayBuffer();
    await putChunk(init.uploadHandle, offset, buf, signal);
    offset += buf.byteLength;
    onProgress?.(offset, file.size);
  }

  const result = await api.post<UploadCompleteResponse>(
    `/api/publish/uploads/${init.uploadHandle}/complete`,
  );
  return result;
}
