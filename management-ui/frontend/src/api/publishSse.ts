export interface SseEvent {
  event: string;
  data: unknown;
}

export interface OpenAiStreamOpts {
  prompt: string;
  approvals?: 'auto_safe' | 'manual' | 'auto_all';
  context?: Record<string, unknown>;
  onEvent: (e: SseEvent) => void;
  onError?: (err: Error) => void;
  signal?: AbortSignal;
}

/**
 * Fetch-based SSE клиент (использует ReadableStream). EventSource не подходит,
 * так как не поддерживает кастомные заголовки (Bearer token).
 */
export async function openAiStream(opts: OpenAiStreamOpts): Promise<void> {
  const token = localStorage.getItem('auth_token');
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    'Accept': 'text/event-stream',
  };
  if (token) headers.Authorization = `Bearer ${token}`;

  const res = await fetch('/api/publish/ai', {
    method: 'POST',
    headers,
    body: JSON.stringify({
      prompt: opts.prompt,
      approvals: opts.approvals ?? 'auto_safe',
      context: opts.context,
    }),
    signal: opts.signal,
  });
  if (!res.ok || !res.body) {
    const text = await res.text().catch(() => '');
    throw new Error(`SSE error ${res.status}: ${text.slice(0, 200)}`);
  }

  const reader = res.body.getReader();
  const decoder = new TextDecoder('utf-8');
  let buffer = '';
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      // SSE записи отделяются \n\n
      let idx: number;
      while ((idx = buffer.indexOf('\n\n')) !== -1) {
        const chunk = buffer.slice(0, idx);
        buffer = buffer.slice(idx + 2);
        const evt = parseSseChunk(chunk);
        if (evt) opts.onEvent(evt);
      }
    }
  } catch (err) {
    if ((err as Error).name !== 'AbortError') {
      opts.onError?.(err as Error);
    }
  }
}

function parseSseChunk(chunk: string): SseEvent | null {
  let event = 'message';
  let data = '';
  for (const line of chunk.split('\n')) {
    if (line.startsWith(':')) continue; // comment / heartbeat
    if (line.startsWith('event:')) event = line.slice(6).trim();
    else if (line.startsWith('data:')) data += line.slice(5).trim();
  }
  if (!data) return null;
  try {
    return { event, data: JSON.parse(data) };
  } catch {
    return { event, data };
  }
}
