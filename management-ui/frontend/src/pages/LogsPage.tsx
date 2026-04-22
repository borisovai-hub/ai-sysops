import { useEffect, useMemo, useRef, useState } from 'react';
import {
  PlayCircle, XCircle, RefreshCw, Trash2, Pause, Play,
  Server, Boxes, Search, Loader2,
} from 'lucide-react';
import { PageHeader } from '@/components/layout/PageHeader';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { cn } from '@/lib/utils';
import { useLogSources, type LogSource } from '@/api/queries/logs';
import { openLogStream, type LogSseEvent } from '@/api/logsSse';

interface LogLine {
  ts: string;
  text: string;
  level?: 'info' | 'warn' | 'error' | 'debug';
}

const MAX_LINES = 5000;

function detectLevel(text: string): LogLine['level'] {
  const l = text.toLowerCase();
  if (/\b(error|err|panic|fatal|failed|exception)\b/.test(l)) return 'error';
  if (/\b(warn|warning)\b/.test(l)) return 'warn';
  if (/\b(debug|trace)\b/.test(l)) return 'debug';
  return 'info';
}

export function LogsPage() {
  const { data, isLoading } = useLogSources();
  const [activeId, setActiveId] = useState<string | null>(null);
  const [lines, setLines] = useState<LogLine[]>([]);
  const [streaming, setStreaming] = useState(false);
  const [paused, setPaused] = useState(false);
  const [autoscroll, setAutoscroll] = useState(true);
  const [filter, setFilter] = useState('');
  const [levelFilter, setLevelFilter] = useState<'all' | 'error' | 'warn'>('all');
  const [tailLines, setTailLines] = useState(200);
  const abortRef = useRef<AbortController | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);

  const active = useMemo(
    () => data?.sources.find(s => s.id === activeId) ?? null,
    [data, activeId],
  );

  // auto-start stream on source change
  useEffect(() => {
    if (!active) return;
    startStream(active, tailLines, true);
    return () => abortRef.current?.abort();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active?.id]);

  // autoscroll
  useEffect(() => {
    if (autoscroll && !paused && scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [lines, autoscroll, paused]);

  const startStream = async (src: LogSource, linesN: number, follow: boolean) => {
    abortRef.current?.abort();
    setLines([]);
    setStreaming(true);
    const ctl = new AbortController();
    abortRef.current = ctl;
    try {
      await openLogStream({
        source: src.id,
        lines: linesN,
        follow,
        signal: ctl.signal,
        onEvent: (e: LogSseEvent) => {
          if (e.event === 'line') {
            const d = e.data as { ts: string; text: string };
            if (paused) return;
            setLines(prev => {
              const next = [...prev, { ts: d.ts, text: d.text, level: detectLevel(d.text) }];
              if (next.length > MAX_LINES) return next.slice(-MAX_LINES);
              return next;
            });
          } else if (e.event === 'error') {
            const d = e.data as { message: string };
            setLines(prev => [...prev, {
              ts: new Date().toISOString(),
              text: `[stream error] ${d.message}`,
              level: 'error',
            }]);
          } else if (e.event === 'done') {
            setStreaming(false);
          }
        },
        onError: (err) => {
          setLines(prev => [...prev, {
            ts: new Date().toISOString(),
            text: `[connection error] ${err.message}`,
            level: 'error',
          }]);
          setStreaming(false);
        },
      });
    } finally {
      setStreaming(false);
    }
  };

  const stopStream = () => {
    abortRef.current?.abort();
    setStreaming(false);
  };

  const restartStream = () => {
    if (active) startStream(active, tailLines, true);
  };

  const filtered = useMemo(() => {
    const f = filter.trim().toLowerCase();
    return lines.filter(l =>
      (!f || l.text.toLowerCase().includes(f)) &&
      (levelFilter === 'all' || l.level === levelFilter),
    );
  }, [lines, filter, levelFilter]);

  const groups = useMemo(() => {
    const map: Record<string, LogSource[]> = {};
    for (const s of data?.sources ?? []) {
      const g = s.group ?? 'other';
      (map[g] ??= []).push(s);
    }
    return map;
  }, [data]);

  return (
    <div className="flex flex-col gap-4">
      <PageHeader
        title="Логи сервисов"
        description="Live-стрим systemd и docker-сервисов. Источники из whitelist."
        actions={
          <div className="flex items-center gap-2 text-xs text-muted-foreground">
            {data?.diagnostics && (
              <>
                <Badge variant="outline" className={data.diagnostics.journalctl ? '' : 'text-red-500'}>
                  journalctl {data.diagnostics.journalctl ? 'ok' : 'n/a'}
                </Badge>
                <Badge variant="outline" className={data.diagnostics.docker ? '' : 'text-red-500'}>
                  docker {data.diagnostics.docker ? 'ok' : 'n/a'}
                </Badge>
              </>
            )}
          </div>
        }
      />

      <div className="grid gap-4 lg:grid-cols-[260px_1fr]">
        {/* Список источников */}
        <Card>
          <CardContent className="p-2 flex flex-col gap-1 max-h-[calc(100vh-200px)] overflow-y-auto">
            {isLoading && <div className="p-4 text-sm text-muted-foreground">Загрузка...</div>}
            {Object.entries(groups).map(([group, sources]) => (
              <div key={group} className="flex flex-col gap-0.5 mt-2 first:mt-0">
                <div className="text-[10px] uppercase tracking-wider text-muted-foreground px-2 py-1">{group}</div>
                {sources.map(s => (
                  <button
                    key={s.id}
                    onClick={() => setActiveId(s.id)}
                    className={cn(
                      'flex items-center gap-2 rounded-md px-2 py-1.5 text-sm text-left',
                      activeId === s.id
                        ? 'bg-accent/10 text-accent'
                        : 'text-muted-foreground hover:text-foreground hover:bg-muted',
                    )}
                  >
                    {s.type === 'systemd' ? <Server className="h-3.5 w-3.5" /> : <Boxes className="h-3.5 w-3.5" />}
                    <span className="flex-1 truncate">{s.label}</span>
                    <span className="text-[10px] text-muted-foreground">{s.type === 'systemd' ? 'svc' : 'docker'}</span>
                  </button>
                ))}
              </div>
            ))}
          </CardContent>
        </Card>

        {/* Вью логов */}
        <Card>
          <CardContent className="p-0 flex flex-col h-[calc(100vh-180px)]">
            <div className="p-2 border-b border-border flex items-center gap-2 flex-wrap">
              {!active && <div className="text-sm text-muted-foreground px-2">Выберите сервис слева</div>}
              {active && (
                <>
                  <div className="flex items-center gap-2 text-sm">
                    {active.type === 'systemd' ? <Server className="h-4 w-4" /> : <Boxes className="h-4 w-4" />}
                    <span className="font-medium">{active.label}</span>
                    <code className="text-xs text-muted-foreground">{active.target}</code>
                  </div>
                  <div className="flex-1" />
                  <div className="flex items-center gap-2">
                    <Search className="h-4 w-4 text-muted-foreground" />
                    <Input
                      placeholder="Фильтр..."
                      value={filter}
                      onChange={(e) => setFilter(e.target.value)}
                      className="h-8 w-[180px]"
                    />
                    <select
                      value={levelFilter}
                      onChange={(e) => setLevelFilter(e.target.value as typeof levelFilter)}
                      className="h-8 rounded-md border border-border bg-background px-2 text-xs"
                    >
                      <option value="all">все</option>
                      <option value="error">только error</option>
                      <option value="warn">warn+error</option>
                    </select>
                    <select
                      value={tailLines}
                      onChange={(e) => setTailLines(Number(e.target.value))}
                      className="h-8 rounded-md border border-border bg-background px-2 text-xs"
                      title="Tail N строк перед follow"
                    >
                      <option value={100}>100</option>
                      <option value={200}>200</option>
                      <option value={500}>500</option>
                      <option value={1000}>1000</option>
                      <option value={2000}>2000</option>
                    </select>
                    <Button size="sm" variant="outline" onClick={() => setPaused(p => !p)} title={paused ? 'Продолжить' : 'Пауза'}>
                      {paused ? <Play className="h-4 w-4" /> : <Pause className="h-4 w-4" />}
                    </Button>
                    <Button size="sm" variant="outline" onClick={() => setLines([])} title="Очистить">
                      <Trash2 className="h-4 w-4" />
                    </Button>
                    {streaming ? (
                      <Button size="sm" variant="outline" onClick={stopStream} title="Остановить">
                        <XCircle className="h-4 w-4" />
                      </Button>
                    ) : (
                      <Button size="sm" variant="outline" onClick={restartStream} title="Запустить">
                        <PlayCircle className="h-4 w-4" />
                      </Button>
                    )}
                    <Button size="sm" variant="outline" onClick={restartStream} title="Перезапустить">
                      <RefreshCw className="h-4 w-4" />
                    </Button>
                  </div>
                </>
              )}
            </div>

            <div
              ref={scrollRef}
              onScroll={(e) => {
                const el = e.currentTarget;
                const atBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 20;
                setAutoscroll(atBottom);
              }}
              className="flex-1 overflow-y-auto bg-background font-mono text-xs p-2 leading-[1.4]"
            >
              {active && filtered.length === 0 && !streaming && (
                <div className="text-muted-foreground p-4">Логи пустые. Попробуйте увеличить tail или снять фильтр.</div>
              )}
              {active && streaming && filtered.length === 0 && (
                <div className="text-muted-foreground p-4 flex items-center gap-2">
                  <Loader2 className="h-4 w-4 animate-spin" /> Ожидание данных...
                </div>
              )}
              {filtered.map((l, i) => (
                <div key={i} className={cn(
                  'whitespace-pre-wrap break-all border-l-2 pl-2 py-0.5',
                  l.level === 'error' && 'border-red-500 text-red-500',
                  l.level === 'warn' && 'border-amber-500 text-amber-500',
                  l.level === 'info' && 'border-transparent',
                  l.level === 'debug' && 'border-transparent text-muted-foreground',
                )}>
                  {l.text}
                </div>
              ))}
            </div>

            <div className="p-1.5 border-t border-border text-xs text-muted-foreground flex items-center gap-3">
              <span>{filtered.length} / {lines.length} строк(и)</span>
              {paused && <Badge variant="outline" className="text-amber-500">pause</Badge>}
              {streaming && !paused && <Badge variant="outline" className="text-emerald-500">live</Badge>}
              {!autoscroll && <Badge variant="outline">autoscroll off</Badge>}
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
