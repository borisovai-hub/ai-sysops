import { useState, useRef, useEffect, useCallback } from 'react';
import { Bot, Send, Plus, Trash2, Shield, ShieldCheck, ShieldX, Terminal, FileText, Loader2 } from 'lucide-react';
import { PageHeader } from '@/components/layout/PageHeader';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { useAgentSessions, useAgentMessages, usePendingApprovals } from '@/api/queries/agent';
import { useCreateSession, useDeleteSession, useApproveAction, useDenyAction } from '@/api/mutations/agent';

interface SSEMessage {
  type: string;
  text?: string;
  message?: string;
  name?: string;
  args?: Record<string, unknown>;
  output?: string;
  success?: boolean;
  tier?: string;
  approvalId?: string;
  toolName?: string;
}

export function AgentPage() {
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [input, setInput] = useState('');
  const [streaming, setStreaming] = useState(false);
  const [streamText, setStreamText] = useState('');
  const [streamEvents, setStreamEvents] = useState<SSEMessage[]>([]);
  const messagesEndRef = useRef<HTMLDivElement>(null);

  const { data: sessions, isLoading: loadingSessions } = useAgentSessions();
  const { data: messages, refetch: refetchMessages } = useAgentMessages(sessionId);
  const { data: approvals } = usePendingApprovals(sessionId);
  const createSession = useCreateSession();
  const deleteSession = useDeleteSession();
  const approveAction = useApproveAction();
  const denyAction = useDenyAction();

  const scrollToBottom = useCallback(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, []);

  useEffect(scrollToBottom, [messages, streamText, streamEvents, scrollToBottom]);

  const sendMessage = async () => {
    if (!input.trim() || streaming) return;
    const msg = input.trim();
    setInput('');
    setStreaming(true);
    setStreamText('');
    setStreamEvents([]);

    try {
      const res = await fetch('/api/agent/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sessionId, message: msg }),
      });

      // Получаем session ID из header (если создана новая)
      const newSessionId = res.headers.get('X-Session-Id');
      if (newSessionId && newSessionId !== sessionId) {
        setSessionId(newSessionId);
      }

      const reader = res.body?.getReader();
      const decoder = new TextDecoder();
      let buffer = '';

      while (reader) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() || '';

        for (const line of lines) {
          if (!line.startsWith('data: ')) continue;
          const data = line.slice(6);
          if (data === '[DONE]') continue;

          try {
            const event: SSEMessage = JSON.parse(data);
            if (event.type === 'text_delta' && event.text) {
              setStreamText((prev) => prev + event.text);
            } else if (event.type === 'tool_call' || event.type === 'tool_result' || event.type === 'approval_required') {
              setStreamEvents((prev) => [...prev, event]);
            } else if (event.type === 'error') {
              setStreamEvents((prev) => [...prev, event]);
            }
          } catch { /* skip */ }
        }
      }
    } catch (err) {
      setStreamEvents((prev) => [...prev, { type: 'error', message: String(err) }]);
    } finally {
      setStreaming(false);
      refetchMessages();
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      sendMessage();
    }
  };

  const handleNewSession = () => {
    createSession.mutate({}, {
      onSuccess: (data) => setSessionId((data as { id: string }).id),
    });
  };

  const pendingApprovalsList = Array.isArray(approvals)
    ? approvals.filter((a: { status: string }) => a.status === 'pending')
    : [];

  return (
    <>
      <PageHeader
        title="AI Агент"
        description="Агент с доступом к машине"
        actions={
          <Button size="sm" onClick={handleNewSession}>
            <Plus className="h-4 w-4" /> Новая сессия
          </Button>
        }
      />

      <div className="flex gap-4 h-[calc(100vh-12rem)]">
        {/* Sidebar — сессии */}
        <div className="w-56 shrink-0 space-y-1 overflow-y-auto">
          {loadingSessions ? (
            <Skeleton className="h-8 w-full" />
          ) : (
            (sessions as { id: string; title: string; updatedAt: string }[] || []).map((s) => (
              <div
                key={s.id}
                className={`flex items-center gap-1 rounded-md px-2 py-1.5 text-sm cursor-pointer hover:bg-muted ${
                  s.id === sessionId ? 'bg-muted font-medium' : ''
                }`}
                onClick={() => setSessionId(s.id)}
              >
                <Bot className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                <span className="truncate flex-1">{s.title || 'Без названия'}</span>
                <button
                  className="opacity-0 group-hover:opacity-100 hover:text-destructive"
                  onClick={(e) => {
                    e.stopPropagation();
                    deleteSession.mutate(s.id);
                    if (sessionId === s.id) setSessionId(null);
                  }}
                >
                  <Trash2 className="h-3 w-3" />
                </button>
              </div>
            ))
          )}
        </div>

        {/* Chat area */}
        <div className="flex-1 flex flex-col min-w-0">
          {/* Messages */}
          <div className="flex-1 overflow-y-auto space-y-3 pb-4">
            {!sessionId ? (
              <div className="flex items-center justify-center h-full text-muted-foreground">
                Выберите сессию или создайте новую
              </div>
            ) : (
              <>
                {((messages ?? []) as Array<{ id: string; role: string; content: string; toolName?: string; toolTier?: string }>).map((msg, i) => (
                  <MessageBubble key={msg.id || i} msg={msg} />
                ))}

                {/* Streaming content */}
                {streaming && streamText && (
                  <div className="flex gap-2">
                    <Bot className="h-5 w-5 mt-1 text-accent shrink-0" />
                    <div className="rounded-lg bg-muted px-3 py-2 text-sm whitespace-pre-wrap max-w-[80%]">
                      {streamText}
                    </div>
                  </div>
                )}

                {/* Stream events (tool calls, results) */}
                {streamEvents.map((evt, i) => (
                  <StreamEvent key={i} event={evt} />
                ))}

                {streaming && (
                  <div className="flex items-center gap-2 text-muted-foreground text-sm">
                    <Loader2 className="h-4 w-4 animate-spin" />
                    Агент думает...
                  </div>
                )}

                {/* Pending approvals */}
                {pendingApprovalsList.map((a: { id: string; toolName: string; toolArgs: string }) => (
                  <ApprovalCard
                    key={a.id}
                    approval={a}
                    onApprove={() => approveAction.mutate(a.id)}
                    onDeny={() => denyAction.mutate({ id: a.id })}
                  />
                ))}

                <div ref={messagesEndRef} />
              </>
            )}
          </div>

          {/* Input */}
          {sessionId && (
            <div className="flex gap-2 pt-2 border-t border-border">
              <Input
                value={input}
                onChange={(e) => setInput(e.target.value)}
                onKeyDown={handleKeyDown}
                placeholder="Введите сообщение..."
                disabled={streaming}
                className="flex-1"
              />
              <Button onClick={sendMessage} disabled={streaming || !input.trim()}>
                <Send className="h-4 w-4" />
              </Button>
            </div>
          )}
        </div>
      </div>
    </>
  );
}

// --- Sub-components ---

function MessageBubble({ msg }: { msg: { role: string; content: string; toolName?: string; toolTier?: string } }) {
  if (msg.role === 'user') {
    return (
      <div className="flex justify-end">
        <div className="rounded-lg bg-accent text-accent-foreground px-3 py-2 text-sm max-w-[80%] whitespace-pre-wrap">
          {msg.content}
        </div>
      </div>
    );
  }

  if (msg.role === 'assistant') {
    return (
      <div className="flex gap-2">
        <Bot className="h-5 w-5 mt-1 text-accent shrink-0" />
        <div className="rounded-lg bg-muted px-3 py-2 text-sm max-w-[80%] whitespace-pre-wrap">
          {msg.content}
        </div>
      </div>
    );
  }

  if (msg.role === 'tool_call') {
    return (
      <div className="flex gap-2 items-start">
        <Terminal className="h-4 w-4 mt-1 text-yellow-500 shrink-0" />
        <div className="text-xs font-mono bg-muted/50 rounded px-2 py-1 max-w-[90%]">
          <span className="font-semibold">{msg.toolName}</span>
          {msg.toolTier === 'approve' && <Badge variant="outline" className="ml-1 text-[10px]">подтверждение</Badge>}
          <pre className="text-muted-foreground mt-0.5 overflow-x-auto">{msg.content}</pre>
        </div>
      </div>
    );
  }

  if (msg.role === 'tool_result') {
    return (
      <div className="flex gap-2 items-start">
        <FileText className="h-4 w-4 mt-1 text-green-500 shrink-0" />
        <pre className="text-xs font-mono bg-muted/30 rounded px-2 py-1 max-w-[90%] overflow-x-auto max-h-48 overflow-y-auto">
          {msg.content}
        </pre>
      </div>
    );
  }

  return null;
}

function StreamEvent({ event }: { event: SSEMessage }) {
  if (event.type === 'tool_call') {
    return (
      <div className="flex gap-2 items-start">
        <Terminal className="h-4 w-4 mt-1 text-yellow-500 shrink-0" />
        <div className="text-xs font-mono bg-yellow-50 dark:bg-yellow-900/20 rounded px-2 py-1">
          <span className="font-semibold">{event.name}</span>
          {event.tier === 'approve' && <Badge variant="outline" className="ml-1 text-[10px]">ожидает</Badge>}
          <pre className="text-muted-foreground mt-0.5">{JSON.stringify(event.args, null, 2)}</pre>
        </div>
      </div>
    );
  }

  if (event.type === 'tool_result') {
    return (
      <div className="flex gap-2 items-start">
        <FileText className="h-4 w-4 mt-1 text-green-500 shrink-0" />
        <pre className="text-xs font-mono bg-green-50 dark:bg-green-900/20 rounded px-2 py-1 max-h-48 overflow-y-auto">
          {event.output}
        </pre>
      </div>
    );
  }

  if (event.type === 'error') {
    return (
      <div className="text-sm text-destructive bg-destructive/10 rounded px-3 py-2">
        {event.message}
      </div>
    );
  }

  return null;
}

function ApprovalCard({
  approval,
  onApprove,
  onDeny,
}: {
  approval: { id: string; toolName: string; toolArgs: string };
  onApprove: () => void;
  onDeny: () => void;
}) {
  let parsedArgs: Record<string, unknown> = {};
  try { parsedArgs = JSON.parse(approval.toolArgs); } catch { /* */ }

  return (
    <Card className="border-yellow-500/50 bg-yellow-50 dark:bg-yellow-900/10">
      <CardContent className="p-3">
        <div className="flex items-center gap-2 mb-2">
          <Shield className="h-4 w-4 text-yellow-600" />
          <span className="font-medium text-sm">Подтверждение: {approval.toolName}</span>
        </div>
        <pre className="text-xs font-mono bg-background/50 rounded p-2 mb-2 overflow-x-auto">
          {JSON.stringify(parsedArgs, null, 2)}
        </pre>
        <div className="flex gap-2">
          <Button size="sm" onClick={onApprove} className="gap-1">
            <ShieldCheck className="h-3.5 w-3.5" /> Разрешить
          </Button>
          <Button size="sm" variant="outline" onClick={onDeny} className="gap-1">
            <ShieldX className="h-3.5 w-3.5" /> Отклонить
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
