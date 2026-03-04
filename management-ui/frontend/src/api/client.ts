const BASE_URL = '';

export class ApiError extends Error {
  status: number;
  data: unknown;

  constructor(status: number, message: string, data?: unknown) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.data = data;
  }
}

export async function apiFetch<T = unknown>(
  path: string,
  options: RequestInit = {},
): Promise<T> {
  const headers: Record<string, string> = {};

  // Only set Content-Type for requests that have a body
  if (options.body != null) {
    headers['Content-Type'] = 'application/json';
  }

  // Attach saved Bearer token if present
  const token = localStorage.getItem('auth_token');
  if (token) {
    headers['Authorization'] = `Bearer ${token}`;
  }

  const res = await fetch(`${BASE_URL}${path}`, {
    ...options,
    headers: {
      ...headers,
      ...(options.headers as Record<string, string>),
    },
  });

  if (!res.ok) {
    // 401 → redirect to login (except auth check itself)
    if (res.status === 401 && !path.includes('/api/auth/check')) {
      window.location.href = '/login';
      throw new ApiError(401, 'Требуется авторизация');
    }

    let data: unknown;
    try {
      data = await res.json();
    } catch {
      data = null;
    }
    const msg = (data && typeof data === 'object' && 'error' in data)
      ? String((data as { error: string }).error)
      : res.statusText;
    throw new ApiError(res.status, msg, data);
  }

  if (res.status === 204 || res.headers.get('content-length') === '0') {
    return undefined as T;
  }

  return res.json() as Promise<T>;
}

export const api = {
  get: <T = unknown>(path: string) => apiFetch<T>(path),
  post: <T = unknown>(path: string, body?: unknown) =>
    apiFetch<T>(path, { method: 'POST', body: body != null ? JSON.stringify(body) : undefined }),
  put: <T = unknown>(path: string, body?: unknown) =>
    apiFetch<T>(path, { method: 'PUT', body: body != null ? JSON.stringify(body) : undefined }),
  delete: <T = unknown>(path: string, body?: unknown) =>
    apiFetch<T>(path, { method: 'DELETE', body: body != null ? JSON.stringify(body) : undefined }),
};
