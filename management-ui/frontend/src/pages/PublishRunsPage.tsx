import { useState } from 'react';
import { toast } from 'sonner';
import { Eye, RefreshCw, Undo2, CheckCircle2, Loader2 } from 'lucide-react';
import { PageHeader } from '@/components/layout/PageHeader';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Table, TableHeader, TableBody, TableRow, TableHead, TableCell } from '@/components/ui/table';
import { Dialog, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Skeleton } from '@/components/ui/skeleton';
import { ConfirmDialog } from '@/components/feedback/ConfirmDialog';
import { usePublishRuns, usePublishRun } from '@/api/queries/publish';
import { useRollbackPublish, useVerifyDeployment } from '@/api/mutations/publish';
import { ApiError } from '@/api/client';

const statusColors: Record<string, string> = {
  ok: 'bg-emerald-500/10 text-emerald-600 border-emerald-400/30',
  partial: 'bg-amber-500/10 text-amber-600 border-amber-400/30',
  failed: 'bg-red-500/10 text-red-600 border-red-400/30',
  running: 'bg-blue-500/10 text-blue-600 border-blue-400/30',
  planning: 'bg-violet-500/10 text-violet-600 border-violet-400/30',
  pending: 'bg-slate-500/10 text-slate-600 border-slate-400/30',
  rolled_back: 'bg-slate-500/10 text-slate-600 border-slate-400/30',
  waiting_approval: 'bg-orange-500/10 text-orange-600 border-orange-400/30',
};

export function PublishRunsPage() {
  const [slugFilter, setSlugFilter] = useState('');
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [rollbackId, setRollbackId] = useState<string | null>(null);
  const { data, isLoading, refetch } = usePublishRuns({ slug: slugFilter || undefined, limit: 100 });
  const rollbackMut = useRollbackPublish();
  const verifyMut = useVerifyDeployment();

  const handleRollback = () => {
    if (!rollbackId) return;
    rollbackMut.mutate(
      { publishId: rollbackId, confirmDestructive: true },
      {
        onSuccess: () => { toast.success('Rollback запущен'); setRollbackId(null); },
        onError: (err) => toast.error(err instanceof ApiError ? err.message : 'Ошибка rollback'),
      },
    );
  };

  const handleVerify = (slug: string) => {
    verifyMut.mutate(slug, {
      onSuccess: (r) => {
        const overall = (r as { overall?: string })?.overall ?? 'unknown';
        toast.success(`verify ${slug}: ${overall}`);
      },
      onError: (err) => toast.error(err instanceof ApiError ? err.message : 'Ошибка verify'),
    });
  };

  return (
    <div className="flex flex-col gap-4">
      <PageHeader
        title="История публикаций"
        description="Прогоны AI Publisher: статус, шаги, rollback, verify"
        actions={
          <div className="flex items-center gap-2">
            <Input
              placeholder="Фильтр по slug..."
              value={slugFilter}
              onChange={(e) => setSlugFilter(e.target.value)}
              className="w-[200px]"
            />
            <Button size="sm" variant="outline" onClick={() => refetch()}>
              <RefreshCw className="h-4 w-4" />
            </Button>
          </div>
        }
      />

      <Card>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>ID</TableHead>
                <TableHead>slug</TableHead>
                <TableHead>тип</TableHead>
                <TableHead>статус</TableHead>
                <TableHead>создан</TableHead>
                <TableHead>обновлён</TableHead>
                <TableHead className="text-right">действия</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {isLoading && [...Array(4)].map((_, i) => (
                <TableRow key={i}>
                  <TableCell colSpan={7}><Skeleton className="h-6 w-full" /></TableCell>
                </TableRow>
              ))}
              {!isLoading && data?.runs.length === 0 && (
                <TableRow><TableCell colSpan={7} className="text-center text-muted-foreground py-8">Нет прогонов</TableCell></TableRow>
              )}
              {data?.runs.map(run => (
                <TableRow key={run.id}>
                  <TableCell className="font-mono text-xs">{run.id.slice(0, 20)}...</TableCell>
                  <TableCell className="font-medium">{run.slug}</TableCell>
                  <TableCell>
                    <Badge variant="outline">{run.type}</Badge>
                    {run.dryRun && <Badge variant="outline" className="ml-1 text-xs">dry</Badge>}
                  </TableCell>
                  <TableCell>
                    <Badge className={statusColors[run.status] ?? 'bg-muted'}>{run.status}</Badge>
                  </TableCell>
                  <TableCell className="text-xs text-muted-foreground">{new Date(run.createdAt).toLocaleString('ru')}</TableCell>
                  <TableCell className="text-xs text-muted-foreground">{new Date(run.updatedAt).toLocaleString('ru')}</TableCell>
                  <TableCell className="text-right">
                    <div className="inline-flex gap-1">
                      <Button size="sm" variant="ghost" onClick={() => setSelectedId(run.id)} title="Детали">
                        <Eye className="h-4 w-4" />
                      </Button>
                      <Button size="sm" variant="ghost" onClick={() => handleVerify(run.slug)} title="Verify">
                        <CheckCircle2 className="h-4 w-4" />
                      </Button>
                      {(run.status === 'ok' || run.status === 'partial') && !run.dryRun && (
                        <Button size="sm" variant="ghost" onClick={() => setRollbackId(run.id)} title="Rollback">
                          <Undo2 className="h-4 w-4" />
                        </Button>
                      )}
                    </div>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      {selectedId && <RunDetailsDialog runId={selectedId} onClose={() => setSelectedId(null)} />}
      <ConfirmDialog
        open={!!rollbackId}
        onOpenChange={(v) => !v && setRollbackId(null)}
        title="Откатить публикацию?"
        description="Все выполненные шаги будут отменены в обратном порядке. Destructive-шаги (DELETE DNS, rm файлов) тоже выполнятся."
        confirmLabel="Откатить"
        onConfirm={handleRollback}
        destructive
      />
    </div>
  );
}

function RunDetailsDialog({ runId, onClose }: { runId: string; onClose: () => void }) {
  const { data, isLoading } = usePublishRun(runId);
  return (
    <Dialog open onOpenChange={(v) => !v && onClose()}>
      <DialogHeader>
        <DialogTitle>Публикация {runId}</DialogTitle>
      </DialogHeader>
      <div className="flex flex-col gap-3 max-h-[70vh] overflow-auto">
        {isLoading && <Loader2 className="h-4 w-4 animate-spin mx-auto my-8" />}
        {data && (
          <>
            <div className="grid grid-cols-2 gap-2 text-sm">
              <div><span className="text-muted-foreground">slug:</span> <code>{data.slug}</code></div>
              <div><span className="text-muted-foreground">type:</span> <code>{data.type}</code></div>
              <div><span className="text-muted-foreground">status:</span>
                <Badge className={`ml-1 ${statusColors[data.status] ?? ''}`}>{data.status}</Badge>
              </div>
              <div><span className="text-muted-foreground">idempotencyKey:</span> <code className="text-xs">{data.idempotencyKey}</code></div>
            </div>
            <div>
              <h4 className="text-sm font-medium mb-2">Шаги</h4>
              <div className="flex flex-col gap-1">
                {data.steps.map((s, i) => (
                  <div key={i} className="rounded border border-border p-2 text-xs flex flex-col gap-1">
                    <div className="flex items-center gap-2">
                      <Badge variant="outline">{s.kind}</Badge>
                      <Badge className={statusColors[s.status] ?? 'bg-muted'}>{s.status}</Badge>
                      {s.requiresApproval && <Badge variant="outline" className="text-orange-500">approval</Badge>}
                    </div>
                    {s.detail && <div className="text-muted-foreground">{s.detail}</div>}
                    {s.error && <div className="text-red-500">{s.error}</div>}
                    {s.after && (
                      <details>
                        <summary className="cursor-pointer text-muted-foreground">after</summary>
                        <pre className="mt-1 bg-muted/30 p-2 rounded overflow-auto">{JSON.stringify(s.after, null, 2)}</pre>
                      </details>
                    )}
                  </div>
                ))}
              </div>
            </div>
            {data.errors.length > 0 && (
              <div>
                <h4 className="text-sm font-medium mb-1 text-red-500">Ошибки</h4>
                <ul className="text-xs list-disc pl-5">
                  {data.errors.map((e, i) => <li key={i}>{e}</li>)}
                </ul>
              </div>
            )}
          </>
        )}
      </div>
    </Dialog>
  );
}
