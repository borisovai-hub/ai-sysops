import { useState } from 'react';
import { toast } from 'sonner';
import { Server, Plus, Trash2, RefreshCw, KeyRound, ClipboardCopy, CheckCircle2, XCircle, AlertTriangle } from 'lucide-react';
import { PageHeader } from '@/components/layout/PageHeader';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Dialog, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Skeleton } from '@/components/ui/skeleton';
import { EmptyState } from '@/components/feedback/EmptyState';
import {
  useServers,
  useCreateServer,
  useDeleteServer,
  useTestServer,
  useRotateBootstrapToken,
  type ServerWithHealth,
} from '@/api/queries/servers';
import type { CreateServerResponse } from '@management-ui/shared';

function copyToClipboard(text: string, label: string) {
  navigator.clipboard.writeText(text).then(
    () => toast.success(`${label} скопирован`),
    () => toast.error('Не удалось скопировать'),
  );
}

function HealthBadge({ s }: { s: ServerWithHealth }) {
  if (s.health.reachable) {
    return (
      <Badge variant="default" className="bg-green-600">
        <CheckCircle2 className="h-3 w-3 mr-1" />reachable
      </Badge>
    );
  }
  return (
    <Badge variant="destructive">
      <XCircle className="h-3 w-3 mr-1" />unreachable
    </Badge>
  );
}

function BootstrapTokenDialog({ data, onClose }: { data: CreateServerResponse; onClose: () => void }) {
  return (
    <Dialog open={true} onOpenChange={(open) => !open && onClose()}>
      <DialogHeader>
        <DialogTitle className="flex items-center gap-2">
          <AlertTriangle className="h-5 w-5 text-amber-500" />
          Bootstrap-токен — показывается ОДИН раз
        </DialogTitle>
      </DialogHeader>
      <div className="space-y-4 mt-4">
        <div className="text-sm text-muted-foreground">
          Сохраните команду для запуска install-node-agent.sh на новом сервере {data.server.name}.
          Токен действителен 1 час и используется однократно.
        </div>

        <div>
          <div className="flex items-center justify-between mb-1">
            <label className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
              Команда установки
            </label>
            <Button size="sm" variant="ghost" onClick={() => copyToClipboard(data.bootstrap_command, 'Команда')}>
              <ClipboardCopy className="h-3 w-3" />
            </Button>
          </div>
          <pre className="bg-muted text-xs p-3 rounded-md overflow-x-auto whitespace-pre-wrap break-all">
            {data.bootstrap_command}
          </pre>
        </div>

        <div className="grid grid-cols-2 gap-4 text-sm">
          <div>
            <div className="text-xs text-muted-foreground">CA URL</div>
            <code className="text-xs">{data.ca_url}</code>
          </div>
          <div>
            <div className="text-xs text-muted-foreground">Root fingerprint</div>
            <code className="text-xs break-all">{data.ca_root_fingerprint}</code>
          </div>
        </div>

        <Button onClick={onClose} className="w-full">Я скопировал, закрыть</Button>
      </div>
    </Dialog>
  );
}

function AddServerDialog({ onCreated }: { onCreated: (resp: CreateServerResponse) => void }) {
  const [open, setOpen] = useState(false);
  const [name, setName] = useState('');
  const [sshHost, setSshHost] = useState('');
  const create = useCreateServer();

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim() || !sshHost.trim()) {
      toast.error('Заполните name и ssh_host');
      return;
    }
    const baseAgentSan = `agent-${name}.internal`;
    const agentUrl = `https://agent.${name}.tunnel.borisovai.ru`;
    create.mutate(
      {
        name,
        role: 'secondary',
        ssh_host: sshHost,
        agent_url: agentUrl,
        agent_san: baseAgentSan,
      },
      {
        onSuccess: (resp) => {
          setOpen(false);
          setName('');
          setSshHost('');
          onCreated(resp);
        },
        onError: (err: Error) => toast.error(err.message),
      },
    );
  };

  return (
    <>
      <Button size="sm" onClick={() => setOpen(true)}>
        <Plus className="h-4 w-4" />Добавить сервер
      </Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogHeader>
          <DialogTitle>Новый сервер</DialogTitle>
        </DialogHeader>
        <form onSubmit={submit} className="space-y-3 mt-4">
          <div>
            <label className="text-sm font-medium">Имя (slug)</label>
            <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="firstvds-sm-22" />
            <div className="text-xs text-muted-foreground mt-1">
              ^[a-z][a-z0-9-]+$ — используется в agent_san и config_dir
            </div>
          </div>
          <div>
            <label className="text-sm font-medium">SSH host (IPv4)</label>
            <Input value={sshHost} onChange={(e) => setSshHost(e.target.value)} placeholder="157.22.203.22" />
          </div>
          <div className="text-xs text-muted-foreground bg-muted p-2 rounded">
            После создания получите одноразовый bootstrap-токен и команду для install-node-agent.sh.
          </div>
          <Button type="submit" disabled={create.isPending} className="w-full">
            {create.isPending ? 'Создание...' : 'Создать и выдать токен'}
          </Button>
        </form>
      </Dialog>
    </>
  );
}

function ServerCard({ s }: { s: ServerWithHealth }) {
  const test = useTestServer();
  const rotate = useRotateBootstrapToken();
  const del = useDeleteServer();
  const [tokenDialog, setTokenDialog] = useState<CreateServerResponse | null>(null);

  return (
    <Card>
      <CardContent className="p-4 space-y-3">
        <div className="flex items-start justify-between">
          <div>
            <div className="font-medium flex items-center gap-2">
              <Server className="h-4 w-4" />
              {s.name}
              <Badge variant={s.role === 'primary' ? 'default' : 'secondary'} className="text-xs">{s.role}</Badge>
              {!s.enabled && <Badge variant="outline">disabled</Badge>}
            </div>
            <div className="text-xs text-muted-foreground mt-1">
              {s.ssh_host} · {s.agent_san}
            </div>
          </div>
          <HealthBadge s={s} />
        </div>

        <div className="text-xs space-y-1">
          {s.health.reachable && (
            <>
              <div>agent v{s.health.agent_version} · uptime {Math.floor((s.health.agent_uptime_seconds ?? 0) / 60)}m</div>
              <div>checkers: {s.health.enabled_checkers?.join(', ') || '—'}</div>
            </>
          )}
          {!s.health.reachable && s.health.error && (
            <div className="text-destructive">{s.health.error}</div>
          )}
        </div>

        <div className="flex gap-2 pt-2 border-t">
          <Button size="sm" variant="outline" onClick={() => test.mutate(s.name, {
            onSuccess: (r) => toast[r.health.reachable ? 'success' : 'error'](
              r.health.reachable ? `${s.name} reachable` : `${s.name} unreachable: ${r.health.error}`,
            ),
          })} disabled={test.isPending}>
            <RefreshCw className={`h-3 w-3 ${test.isPending ? 'animate-spin' : ''}`} />
            Test
          </Button>
          <Button size="sm" variant="outline" onClick={() => rotate.mutate(s.name, {
            onSuccess: (r) => setTokenDialog(r),
            onError: (e: Error) => toast.error(e.message),
          })} disabled={rotate.isPending}>
            <KeyRound className="h-3 w-3" />
            Новый токен
          </Button>
          {s.role !== 'primary' && (
            <Button size="sm" variant="ghost" onClick={() => {
              if (confirm(`Удалить сервер ${s.name}?`)) {
                del.mutate(s.name, { onSuccess: () => toast.success(`${s.name} удалён`) });
              }
            }} disabled={del.isPending}>
              <Trash2 className="h-3 w-3 text-destructive" />
            </Button>
          )}
        </div>

        {tokenDialog && <BootstrapTokenDialog data={tokenDialog} onClose={() => setTokenDialog(null)} />}
      </CardContent>
    </Card>
  );
}

export function ServersPage() {
  const { data, isLoading } = useServers();
  const [tokenDialog, setTokenDialog] = useState<CreateServerResponse | null>(null);

  const servers = data?.servers ?? [];
  const stepCaAvailable = data?.step_ca_available ?? false;

  return (
    <>
      <PageHeader
        title="Серверы"
        description={`${servers.length} зарегистрировано · step-ca ${stepCaAvailable ? 'доступен' : 'недоступен'}`}
        actions={stepCaAvailable && <AddServerDialog onCreated={setTokenDialog} />}
      />

      {!stepCaAvailable && (
        <Card className="mb-4 border-amber-500/50 bg-amber-50/30 dark:bg-amber-950/30">
          <CardContent className="p-4 text-sm">
            <div className="flex items-start gap-2">
              <AlertTriangle className="h-4 w-4 text-amber-600 shrink-0 mt-0.5" />
              <div>
                <div className="font-medium">step-ca не установлен на этом management-ui</div>
                <div className="text-muted-foreground mt-1">
                  Без step-ca невозможно выдавать bootstrap-токены и mTLS не работает.
                  Установите: <code className="text-xs">sudo /opt/borisovai-admin/scripts/single-machine/install-step-ca.sh</code>
                </div>
              </div>
            </div>
          </CardContent>
        </Card>
      )}

      {isLoading ? (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <Skeleton className="h-40" />
          <Skeleton className="h-40" />
        </div>
      ) : servers.length === 0 ? (
        <EmptyState
          icon={Server}
          title="Нет серверов"
          description="Реестр пуст. Добавьте сервер кнопкой выше — получите bootstrap-токен для install-node-agent.sh"
        />
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {servers.map((s) => <ServerCard key={s.name} s={s} />)}
        </div>
      )}

      {tokenDialog && <BootstrapTokenDialog data={tokenDialog} onClose={() => setTokenDialog(null)} />}
    </>
  );
}
