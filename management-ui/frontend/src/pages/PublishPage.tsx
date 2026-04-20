import { useState, useRef, useEffect } from 'react';
import { toast } from 'sonner';
import { Bot, FormInput, PlayCircle, CheckCircle2, XCircle, Loader2, ShieldAlert } from 'lucide-react';
import { PageHeader } from '@/components/layout/PageHeader';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { usePublishService, usePublishProject, useApproveAi } from '@/api/mutations/publish';
import { openAiStream, type SseEvent } from '@/api/publishSse';
import { ApiError } from '@/api/client';

type Mode = 'form' | 'ai';

interface ServiceForm {
  slug: string; title: string;
  prefix: string; middle: string;
  internalIp: string; port: string;
  autheliaEnabled: boolean;
  ruProxyEnabled: boolean;
  idempotencyKey: string;
  dryRun: boolean;
}

const emptyForm: ServiceForm = {
  slug: '', title: '', prefix: '', middle: '',
  internalIp: '127.0.0.1', port: '', autheliaEnabled: true,
  ruProxyEnabled: true, idempotencyKey: '', dryRun: true,
};

export function PublishPage() {
  const [mode, setMode] = useState<Mode>('ai');
  return (
    <div className="flex flex-col gap-4">
      <PageHeader
        title="Публикация"
        description="Развёртывание сервисов и проектов через AI Publisher или форму"
        actions={
          <div className="inline-flex rounded-md border border-border bg-card p-1">
            <Button size="sm" variant={mode === 'ai' ? 'default' : 'ghost'} onClick={() => setMode('ai')}>
              <Bot className="h-4 w-4 mr-1" /> AI режим
            </Button>
            <Button size="sm" variant={mode === 'form' ? 'default' : 'ghost'} onClick={() => setMode('form')}>
              <FormInput className="h-4 w-4 mr-1" /> Форма сервиса
            </Button>
          </div>
        }
      />
      {mode === 'ai' ? <AiPanel /> : <ServiceFormPanel />}
    </div>
  );
}

// --- AI Panel ---

interface AiEventLog {
  event: string;
  data: Record<string, unknown>;
  ts: number;
}

interface PendingApproval {
  approvalId: string;
  toolName: string;
  args: Record<string, unknown>;
  detail: string;
}

function AiPanel() {
  const [prompt, setPrompt] = useState('Покажи план публикации Grafana на grafana.dev с SSO (порт 3000).');
  const [approvals, setApprovals] = useState<'auto_safe' | 'manual' | 'auto_all'>('auto_safe');
  const [events, setEvents] = useState<AiEventLog[]>([]);
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [pendingApproval, setPendingApproval] = useState<PendingApproval | null>(null);
  const [streaming, setStreaming] = useState(false);
  const approveMut = useApproveAi();
  const abortRef = useRef<AbortController | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: 'smooth' });
  }, [events]);

  const start = async () => {
    setEvents([]);
    setPendingApproval(null);
    setSessionId(null);
    setStreaming(true);
    const ctl = new AbortController();
    abortRef.current = ctl;
    try {
      await openAiStream({
        prompt, approvals,
        signal: ctl.signal,
        onEvent: (e: SseEvent) => {
          const data = (e.data || {}) as Record<string, unknown>;
          setEvents(prev => [...prev, { event: e.event, data, ts: Date.now() }]);
          if (e.event === 'session' && typeof data.sessionId === 'string') {
            setSessionId(data.sessionId);
          }
          if (e.event === 'approval_required') {
            setPendingApproval({
              approvalId: String(data.approvalId ?? ''),
              toolName: String(data.toolName ?? ''),
              args: (data.args as Record<string, unknown>) ?? {},
              detail: String(data.detail ?? ''),
            });
          }
          if (e.event === 'done' || e.event === 'error') {
            setStreaming(false);
          }
        },
        onError: (err) => {
          toast.error(`Ошибка стрима: ${err.message}`);
          setStreaming(false);
        },
      });
    } catch (err) {
      toast.error(`Ошибка: ${(err as Error).message}`);
    } finally {
      setStreaming(false);
    }
  };

  const stop = () => {
    abortRef.current?.abort();
    setStreaming(false);
  };

  const resolveApproval = (decision: 'approve' | 'reject') => {
    if (!pendingApproval || !sessionId) return;
    approveMut.mutate(
      { sessionId, approvalId: pendingApproval.approvalId, decision },
      {
        onSuccess: () => {
          toast.success(decision === 'approve' ? 'Подтверждено' : 'Отклонено');
          setPendingApproval(null);
        },
        onError: (err) => toast.error(err instanceof ApiError ? err.message : 'Ошибка'),
      },
    );
  };

  return (
    <div className="grid gap-4 lg:grid-cols-[420px_1fr]">
      <Card>
        <CardContent className="p-4 flex flex-col gap-3">
          <label className="text-sm font-medium">Задача</label>
          <textarea
            className="w-full min-h-[120px] rounded-md border border-border bg-background p-2 text-sm font-mono resize-y"
            value={prompt}
            onChange={(e) => setPrompt(e.target.value)}
            disabled={streaming}
          />
          <label className="text-sm font-medium">Approvals</label>
          <select
            className="rounded-md border border-border bg-background p-2 text-sm"
            value={approvals}
            onChange={(e) => setApprovals(e.target.value as typeof approvals)}
            disabled={streaming}
          >
            <option value="auto_safe">auto_safe — безопасные auto, destructive manual</option>
            <option value="manual">manual — всё требует подтверждения</option>
            <option value="auto_all">auto_all — только forcedManual требует approval</option>
          </select>
          <div className="flex gap-2">
            {!streaming ? (
              <Button onClick={start} className="flex-1">
                <PlayCircle className="h-4 w-4 mr-1" /> Запустить
              </Button>
            ) : (
              <Button onClick={stop} variant="outline" className="flex-1">
                <XCircle className="h-4 w-4 mr-1" /> Остановить
              </Button>
            )}
          </div>
          {pendingApproval && (
            <div className="rounded-md border border-orange-400/40 bg-orange-500/5 p-3 flex flex-col gap-2">
              <div className="flex items-center gap-2 text-orange-500 font-medium">
                <ShieldAlert className="h-4 w-4" />
                Требуется подтверждение
              </div>
              <div className="text-sm">
                <div><span className="text-muted-foreground">Tool:</span> <code className="text-xs">{pendingApproval.toolName}</code></div>
                <div className="text-muted-foreground">{pendingApproval.detail}</div>
                <pre className="mt-2 text-xs bg-muted p-2 rounded max-h-[150px] overflow-auto">
                  {JSON.stringify(pendingApproval.args, null, 2)}
                </pre>
              </div>
              <div className="flex gap-2">
                <Button size="sm" onClick={() => resolveApproval('approve')} className="flex-1">
                  <CheckCircle2 className="h-4 w-4 mr-1" /> Approve
                </Button>
                <Button size="sm" variant="outline" onClick={() => resolveApproval('reject')} className="flex-1">
                  <XCircle className="h-4 w-4 mr-1" /> Reject
                </Button>
              </div>
            </div>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardContent className="p-4 flex flex-col gap-2">
          <div className="flex items-center justify-between">
            <h3 className="text-sm font-medium">События</h3>
            {streaming && <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />}
          </div>
          <div ref={scrollRef} className="h-[calc(100vh-280px)] overflow-y-auto rounded-md border border-border bg-muted/30 p-2 font-mono text-xs flex flex-col gap-1">
            {events.length === 0 && <div className="text-muted-foreground p-4">Нет событий. Нажмите «Запустить», чтобы начать.</div>}
            {events.map((e, i) => <EventRow key={i} log={e} />)}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

function EventRow({ log }: { log: AiEventLog }) {
  const { event, data } = log;
  const colors: Record<string, string> = {
    session: 'border-blue-400 bg-blue-500/5',
    text_delta: 'border-border bg-card',
    plan: 'border-violet-400 bg-violet-500/5',
    tool_call: 'border-amber-400 bg-amber-500/5',
    tool_result: 'border-emerald-400 bg-emerald-500/5',
    approval_required: 'border-orange-400 bg-orange-500/5',
    done: 'border-green-400 bg-green-500/5',
    error: 'border-red-400 bg-red-500/5',
  };
  const cls = colors[event] ?? 'border-border bg-card';
  return (
    <div className={`border-l-2 pl-2 py-1 ${cls}`}>
      <div className="flex items-center gap-2">
        <Badge variant="outline" className="text-[10px]">{event}</Badge>
        {event === 'tool_call' && typeof (data as Record<string, unknown>).toolName === 'string' && (
          <code className="text-xs text-muted-foreground">{String((data as Record<string, unknown>).toolName)}</code>
        )}
      </div>
      {event === 'text_delta' && typeof (data as Record<string, unknown>).text === 'string' && (
        <div className="whitespace-pre-wrap font-sans text-sm mt-1">{String((data as Record<string, unknown>).text)}</div>
      )}
      {event !== 'text_delta' && (
        <details className="mt-1">
          <summary className="text-[11px] text-muted-foreground cursor-pointer">детали</summary>
          <pre className="mt-1 max-h-[200px] overflow-auto">{JSON.stringify(data, null, 2)}</pre>
        </details>
      )}
    </div>
  );
}

// --- Form Panel (service) ---

function ServiceFormPanel() {
  const [form, setForm] = useState<ServiceForm>(emptyForm);
  const [result, setResult] = useState<unknown | null>(null);
  const publishSvc = usePublishService();

  const submit = () => {
    setResult(null);
    if (!form.slug || !form.prefix || !form.port || !form.idempotencyKey) {
      toast.error('Заполните slug, prefix, port, idempotencyKey');
      return;
    }
    publishSvc.mutate(
      {
        slug: form.slug, type: 'service', title: form.title || form.slug,
        domain: { prefix: form.prefix, ...(form.middle ? { middle: form.middle } : {}) },
        backend: { internalIp: form.internalIp, port: Number(form.port) },
        authelia: { enabled: form.autheliaEnabled, policy: 'two_factor' },
        ruProxy: { enabled: form.ruProxyEnabled },
        idempotencyKey: form.idempotencyKey,
        dryRun: form.dryRun,
      },
      {
        onSuccess: (data) => {
          setResult(data);
          toast.success(form.dryRun ? 'Dry-run готов' : 'Публикация завершена');
        },
        onError: (err) => toast.error(err instanceof ApiError ? err.message : 'Ошибка публикации'),
      },
    );
  };

  return (
    <div className="grid gap-4 lg:grid-cols-[420px_1fr]">
      <Card>
        <CardContent className="p-4 flex flex-col gap-3">
          <FormField label="slug" value={form.slug} onChange={(v) => setForm({ ...form, slug: v })} placeholder="grafana" />
          <FormField label="title" value={form.title} onChange={(v) => setForm({ ...form, title: v })} placeholder="Grafana" />
          <div className="grid grid-cols-2 gap-3">
            <FormField label="domain.prefix" value={form.prefix} onChange={(v) => setForm({ ...form, prefix: v })} placeholder="grafana" />
            <FormField label="domain.middle" value={form.middle} onChange={(v) => setForm({ ...form, middle: v })} placeholder="dev" />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <FormField label="backend.internalIp" value={form.internalIp} onChange={(v) => setForm({ ...form, internalIp: v })} />
            <FormField label="backend.port" value={form.port} onChange={(v) => setForm({ ...form, port: v })} placeholder="3000" />
          </div>
          <FormField label="idempotencyKey" value={form.idempotencyKey} onChange={(v) => setForm({ ...form, idempotencyKey: v })} placeholder="grafana-init-v1" />
          <div className="flex items-center gap-3 text-sm">
            <label className="flex items-center gap-2">
              <input type="checkbox" checked={form.autheliaEnabled} onChange={(e) => setForm({ ...form, autheliaEnabled: e.target.checked })} />
              authelia
            </label>
            <label className="flex items-center gap-2">
              <input type="checkbox" checked={form.ruProxyEnabled} onChange={(e) => setForm({ ...form, ruProxyEnabled: e.target.checked })} />
              ruProxy
            </label>
            <label className="flex items-center gap-2 ml-auto">
              <input type="checkbox" checked={form.dryRun} onChange={(e) => setForm({ ...form, dryRun: e.target.checked })} />
              dry-run
            </label>
          </div>
          <Button onClick={submit} disabled={publishSvc.isPending}>
            {publishSvc.isPending ? <Loader2 className="h-4 w-4 mr-1 animate-spin" /> : <PlayCircle className="h-4 w-4 mr-1" />}
            {form.dryRun ? 'Dry-run' : 'Опубликовать'}
          </Button>
        </CardContent>
      </Card>
      <Card>
        <CardContent className="p-4">
          <h3 className="text-sm font-medium mb-2">Результат</h3>
          {result ? (
            <pre className="text-xs font-mono bg-muted/30 p-3 rounded overflow-auto max-h-[calc(100vh-280px)]">
              {JSON.stringify(result, null, 2)}
            </pre>
          ) : (
            <div className="text-sm text-muted-foreground">Результат появится после отправки.</div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

function FormField({ label, value, onChange, placeholder }: {
  label: string; value: string; onChange: (v: string) => void; placeholder?: string;
}) {
  return (
    <label className="flex flex-col gap-1 text-sm">
      <span className="text-muted-foreground text-xs font-mono">{label}</span>
      <Input value={value} onChange={(e) => onChange(e.target.value)} placeholder={placeholder} />
    </label>
  );
}
