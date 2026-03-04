import { useState } from 'react';
import { toast } from 'sonner';
import { GitCommit, Upload, Undo2 } from 'lucide-react';
import { PageHeader } from '@/components/layout/PageHeader';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/card';
import { Table, TableHeader, TableBody, TableRow, TableHead, TableCell } from '@/components/ui/table';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { RelativeTime } from '@/components/shared/RelativeTime';
import { DiffViewer } from '@/components/shared/DiffViewer';
import { useGitStatus, useGitDiff, useGitLog } from '@/api/queries/git';
import { useCommit, usePush, useRevert } from '@/api/mutations/git';
import { ConfirmDialog } from '@/components/feedback/ConfirmDialog';

export function GitPage() {
  const { data: status, isLoading: statusLoading } = useGitStatus();
  const { data: diff } = useGitDiff();
  const { data: log, isLoading: logLoading } = useGitLog();
  const commitMutation = useCommit();
  const pushMutation = usePush();
  const revertMutation = useRevert();

  const [message, setMessage] = useState('');
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [revertTarget, setRevertTarget] = useState<{ hash: string; message: string } | null>(null);

  const files = status?.files ?? [];
  const commits = log?.commits ?? [];

  const toggleFile = (path: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(path)) next.delete(path);
      else next.add(path);
      return next;
    });
  };

  const toggleAll = () =>
    setSelected(selected.size === files.length ? new Set() : new Set(files.map((f: any) => f.path)));

  const handleCommit = () => {
    if (!message.trim() || selected.size === 0) return;
    commitMutation.mutate(
      { message: message.trim(), files: Array.from(selected) },
      { onSuccess: () => { setMessage(''); setSelected(new Set()); toast.success('Коммит создан'); } },
    );
  };

  const statusColor = (s: string) =>
    /^(M|modified)$/.test(s) ? 'warning' : /^(A|added|\?\?|untracked)$/.test(s) ? 'success' : /^(D|deleted)$/.test(s) ? 'destructive' : 'secondary';

  return (
    <>
      <PageHeader
        title="Git"
        description="Статус репозитория, коммиты и пуш"
        actions={
          <Button
            size="sm"
            variant="outline"
            onClick={() => pushMutation.mutate(undefined, { onSuccess: () => toast.success('Push выполнен') })}
            disabled={pushMutation.isPending}
          >
            <Upload className="h-4 w-4" /> {pushMutation.isPending ? 'Pushing...' : 'Push'}
          </Button>
        }
      />

      {/* Changed files */}
      <Card className="mb-6">
        <CardHeader className="pb-2">
          <div className="flex items-center justify-between">
            <CardTitle className="text-sm">Изменённые файлы</CardTitle>
            {files.length > 0 && (
              <Button variant="ghost" size="sm" onClick={toggleAll}>
                {selected.size === files.length ? 'Снять все' : 'Выбрать все'}
              </Button>
            )}
          </div>
        </CardHeader>
        <CardContent>
          {statusLoading ? (
            <div className="space-y-2">
              {Array.from({ length: 3 }).map((_, i) => <Skeleton key={i} className="h-8 w-full" />)}
            </div>
          ) : !files.length ? (
            <p className="text-sm text-muted-foreground py-4 text-center">Нет изменений</p>
          ) : (
            <div className="space-y-1 max-h-64 overflow-y-auto">
              {files.map((f: any) => (
                <label
                  key={f.path}
                  className="flex items-center gap-3 rounded-lg px-3 py-1.5 hover:bg-muted cursor-pointer"
                >
                  <input
                    type="checkbox"
                    checked={selected.has(f.path)}
                    onChange={() => toggleFile(f.path)}
                    className="rounded"
                  />
                  <Badge variant={statusColor(f.status)} className="text-xs w-8 justify-center">
                    {f.status}
                  </Badge>
                  <span className="font-mono text-sm truncate">{f.path}</span>
                </label>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      {/* Commit form */}
      <Card className="mb-6">
        <CardHeader className="pb-2">
          <CardTitle className="text-sm">Коммит</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="flex gap-2">
            <Input
              placeholder="Сообщение коммита"
              value={message}
              onChange={(e) => setMessage(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && handleCommit()}
              className="flex-1"
            />
            <Button
              onClick={handleCommit}
              disabled={commitMutation.isPending || !message.trim() || selected.size === 0}
            >
              <GitCommit className="h-4 w-4" />
              {commitMutation.isPending ? 'Коммит...' : 'Commit'}
            </Button>
          </div>
          {selected.size > 0 && (
            <p className="text-xs text-muted-foreground mt-2">
              Выбрано файлов: {selected.size}
            </p>
          )}
        </CardContent>
      </Card>

      {/* Diff viewer */}
      {diff?.diff && (
        <Card className="mb-6">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm">Diff</CardTitle>
          </CardHeader>
          <CardContent>
            <DiffViewer diff={diff.diff} />
          </CardContent>
        </Card>
      )}

      {/* Commit log */}
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-sm">Журнал коммитов</CardTitle>
        </CardHeader>
        <CardContent>
          {logLoading ? (
            <div className="space-y-2">
              {Array.from({ length: 5 }).map((_, i) => <Skeleton key={i} className="h-10 w-full" />)}
            </div>
          ) : !commits.length ? (
            <p className="text-sm text-muted-foreground py-4 text-center">Нет коммитов</p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Hash</TableHead>
                  <TableHead>Сообщение</TableHead>
                  <TableHead>Автор</TableHead>
                  <TableHead>Дата</TableHead>
                  <TableHead className="w-20">Откат</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {commits.map((c: any) => (
                  <TableRow key={c.hash}>
                    <TableCell className="font-mono text-xs">{c.hash?.slice(0, 7)}</TableCell>
                    <TableCell className="max-w-xs truncate">{c.message}</TableCell>
                    <TableCell className="text-sm">{c.author}</TableCell>
                    <TableCell>
                      {c.date ? <RelativeTime date={c.date} /> : '---'}
                    </TableCell>
                    <TableCell>
                      <Button
                        variant="ghost"
                        size="icon"
                        onClick={() => setRevertTarget({ hash: c.hash, message: c.message })}
                        title="Откатить коммит"
                      >
                        <Undo2 className="h-4 w-4 text-warning" />
                      </Button>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      <ConfirmDialog
        open={!!revertTarget}
        onOpenChange={(v) => !v && setRevertTarget(null)}
        title="Откатить коммит"
        description={`Откатить коммит ${revertTarget?.hash?.slice(0, 7)}: "${revertTarget?.message}"? Будет создан revert-коммит.`}
        onConfirm={() => {
          if (!revertTarget) return;
          revertMutation.mutate(revertTarget.hash, {
            onSuccess: () => {
              setRevertTarget(null);
              toast.success('Коммит откачен');
            },
          });
        }}
        loading={revertMutation.isPending}
      />
    </>
  );
}
