export interface LogSseEvent {
  event: 'meta' | 'line' | 'error' | 'done' | string;
  data: unknown;
}

export interface OpenLogStreamOpts {
  source: string;
  lines?: number;
  follow?: boolean;
  onEvent(e: LogSseEvent): void;
  onError?(err: Error): void;
  signal?: AbortSignal;
}

/**
 * Fetch-based SSE клиент (EventSource не поддерживает Bearer-заголовок).
 */
export async function openLogStream(opts: OpenLogStreamOpts): Promise<void> {
  const token = localStorage.getItem('auth_token');
  const headers: Record<string, string> = { 'Accept': 'text/event-stream' };
  if (token) headers.Authorization = `Bearer ${token}`;
  const qs = new URLSearchParams();
  qs.set('lines', String(opts.lines ?? 200));
  qs.set('follow', String(opts.follow ?? true));

  const res = await fetch(`/api/logs/${encodeURIComponent(opts.source)}/stream?${qs}`, {
    headers,
    signal: opts.signal,
  });
  if (!res.ok || !res.body) {
    const text = await res.text().catch(() => '');
    throw new Error(`log stream error ${res.status}: ${text.slice(0, 200)}`);
  }
  const reader = res.body.getReader();
  const decoder = new TextDecoder('utf-8');
  let buf = '';
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buf += decoder.decode(value, { stream: true });
      let idx: number;
      while ((idx = buf.indexOf('\n\n')) !== -1) {
        const chunk = buf.slice(0, idx);
        buf = buf.slice(idx + 2);
        const parsed = parseSseChunk(chunk);
        if (parsed) opts.onEvent(parsed);
      }
    }
  } catch (err) {
    if ((err as Error).name !== 'AbortError') opts.onError?.(err as Error);
  }
}

function parseSseChunk(chunk: string): LogSseEvent | null {
  let event = 'message';
  let data = '';
  for (const line of chunk.split('\n')) {
    if (line.startsWith(':')) continue;
    if (line.startsWith('event:')) event = line.slice(6).trim();
    else if (line.startsWith('data:')) data += line.slice(5).trim();
  }
  if (!data) return null;
  try { return { event, data: JSON.parse(data) }; }
  catch { return { event, data }; }
}
