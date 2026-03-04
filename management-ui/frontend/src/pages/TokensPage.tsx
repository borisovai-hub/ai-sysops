import { useState } from 'react';
import { toast } from 'sonner';
import { Key, Plus, Trash2, AlertCircle } from 'lucide-react';
import { PageHeader } from '@/components/layout/PageHeader';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Table, TableHeader, TableBody, TableRow, TableHead, TableCell } from '@/components/ui/table';
import { Dialog, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from '@/components/ui/dialog';
import { Skeleton } from '@/components/ui/skeleton';
import { EmptyState } from '@/components/feedback/EmptyState';
import { ConfirmDialog } from '@/components/feedback/ConfirmDialog';
import { CopyButton } from '@/components/shared/CopyButton';
import { RelativeTime } from '@/components/shared/RelativeTime';
import { useTokens } from '@/api/queries/auth';
import { useCreateToken, useDeleteToken } from '@/api/mutations/auth';
import { ApiError } from '@/api/client';

export function TokensPage() {
  const { data: tokens, isLoading } = useTokens();
  const createToken = useCreateToken();
  const deleteToken = useDeleteToken();

  const [dialogOpen, setDialogOpen] = useState(false);
  const [name, setName] = useState('');
  const [formError, setFormError] = useState('');
  const [createdToken, setCreatedToken] = useState<string | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<string | null>(null);

  const openDialog = () => {
    setName('');
    setFormError('');
    setCreatedToken(null);
    createToken.reset();
    setDialogOpen(true);
  };

  const handleCreate = () => {
    setFormError('');
    if (!name.trim()) {
      setFormError('Введите имя токена');
      return;
    }
    createToken.mutate(name, {
      onSuccess: (data) => {
        setName('');
        setCreatedToken(data.token);
        toast.success('Токен создан');
      },
      onError: (err) => {
        setFormError(err instanceof ApiError ? err.message : 'Ошибка создания токена');
      },
    });
  };

  const handleCloseCreated = () => {
    setCreatedToken(null);
    setDialogOpen(false);
  };

  const handleDelete = () => {
    if (!deleteTarget) return;
    deleteToken.mutate(deleteTarget, {
      onSuccess: () => {
        setDeleteTarget(null);
        toast.success('Токен удалён');
      },
    });
  };

  return (
    <>
      <PageHeader
        title="API-токены"
        description="Bearer-токены для программного доступа к API"
        actions={
          <Button size="sm" onClick={openDialog}>
            <Plus className="h-4 w-4" /> Создать токен
          </Button>
        }
      />

      {isLoading ? (
        <div className="space-y-3">
          {Array.from({ length: 3 }).map((_, i) => <Skeleton key={i} className="h-12 w-full" />)}
        </div>
      ) : !tokens?.length ? (
        <EmptyState
          icon={Key}
          title="Нет токенов"
          description="Создайте токен для доступа к API"
          action={<Button onClick={openDialog}><Plus className="h-4 w-4" /> Создать</Button>}
        />
      ) : (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Имя</TableHead>
              <TableHead>Префикс токена</TableHead>
              <TableHead>Создан</TableHead>
              <TableHead className="w-20">Действия</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {tokens.map((t) => (
              <TableRow key={t.id}>
                <TableCell className="font-medium">{t.name}</TableCell>
                <TableCell className="font-mono text-sm">{t.tokenPrefix}...</TableCell>
                <TableCell><RelativeTime date={t.createdAt} /></TableCell>
                <TableCell>
                  <Button variant="ghost" size="icon" onClick={() => setDeleteTarget(t.id)}>
                    <Trash2 className="h-4 w-4 text-destructive" />
                  </Button>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}

      <Dialog open={dialogOpen} onOpenChange={(v) => { if (!v) handleCloseCreated(); else setDialogOpen(true); }}>
        <DialogHeader>
          <DialogTitle>{createdToken ? 'Токен создан' : 'Создать токен'}</DialogTitle>
          <DialogDescription>
            {createdToken
              ? 'Скопируйте токен сейчас. Он больше не будет показан.'
              : 'Введите имя для нового токена'}
          </DialogDescription>
        </DialogHeader>
        {createdToken ? (
          <div className="flex items-center gap-2 rounded-lg border border-border bg-muted p-3">
            <code className="flex-1 break-all text-sm">{createdToken}</code>
            <CopyButton text={createdToken} />
          </div>
        ) : (
          <div className="space-y-3">
            <Input
              placeholder="Имя токена (например, ci-deploy)"
              value={name}
              onChange={(e) => setName(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && name && handleCreate()}
            />
            {formError && (
              <div className="flex items-center gap-1.5 text-sm text-destructive">
                <AlertCircle className="h-3.5 w-3.5 shrink-0" />
                {formError}
              </div>
            )}
          </div>
        )}
        <DialogFooter>
          {createdToken ? (
            <Button onClick={handleCloseCreated}>Закрыть</Button>
          ) : (
            <>
              <Button variant="outline" onClick={() => setDialogOpen(false)}>Отмена</Button>
              <Button onClick={handleCreate} disabled={createToken.isPending || !name}>
                {createToken.isPending ? 'Создание...' : 'Создать'}
              </Button>
            </>
          )}
        </DialogFooter>
      </Dialog>

      <ConfirmDialog
        open={!!deleteTarget}
        onOpenChange={(v) => !v && setDeleteTarget(null)}
        title="Удалить токен"
        description="Удалить этот API-токен? Все запросы с этим токеном перестанут работать."
        onConfirm={handleDelete}
        loading={deleteToken.isPending}
      />
    </>
  );
}
