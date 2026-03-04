import { useState } from 'react';
import { toast } from 'sonner';
import { Globe, Plus, Trash2, AlertCircle, Info } from 'lucide-react';
import { PageHeader } from '@/components/layout/PageHeader';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Table, TableHeader, TableBody, TableRow, TableHead, TableCell } from '@/components/ui/table';
import { Dialog, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from '@/components/ui/dialog';
import { Skeleton } from '@/components/ui/skeleton';
import { EmptyState } from '@/components/feedback/EmptyState';
import { ConfirmDialog } from '@/components/feedback/ConfirmDialog';
import { Badge } from '@/components/ui/badge';
import { useDnsRecords } from '@/api/queries/dns';
import { useCreateDns, useDeleteDns } from '@/api/mutations/dns';
import { ApiError } from '@/api/client';

interface DnsForm {
  subdomain: string;
  domain: string;
  type: string;
  ip: string;
}

const emptyForm: DnsForm = { subdomain: '', domain: 'borisovai.ru', type: 'A', ip: '' };

export function DnsPage() {
  const { data: records, isLoading } = useDnsRecords();
  const createDns = useCreateDns();
  const deleteDns = useDeleteDns();

  const [dialogOpen, setDialogOpen] = useState(false);
  const [form, setForm] = useState<DnsForm>(emptyForm);
  const [formError, setFormError] = useState('');
  const [deleteTarget, setDeleteTarget] = useState<string | null>(null);

  const openDialog = () => {
    setForm(emptyForm);
    setFormError('');
    createDns.reset();
    setDialogOpen(true);
  };

  const handleCreate = () => {
    setFormError('');
    if (!form.ip) {
      setFormError('Укажите IP или значение записи');
      return;
    }
    createDns.mutate(form, {
      onSuccess: (data: any) => {
        setDialogOpen(false);
        setForm(emptyForm);
        if (data?.gitops) {
          toast.success('DNS-запись сохранена', { description: 'Закоммитьте и запушьте на странице Git для деплоя' });
        } else {
          toast.success('DNS-запись создана');
        }
      },
      onError: (err) => {
        setFormError(err instanceof ApiError ? err.message : 'Ошибка создания записи');
      },
    });
  };

  const handleDelete = () => {
    if (!deleteTarget) return;
    deleteDns.mutate(deleteTarget, {
      onSuccess: (data: any) => {
        setDeleteTarget(null);
        if (data?.gitops) {
          toast.success('DNS-запись удалена', { description: 'Закоммитьте и запушьте на странице Git для деплоя' });
        } else {
          toast.success('DNS-запись удалена');
        }
      },
    });
  };

  return (
    <>
      <PageHeader
        title="DNS-записи"
        description="Управление DNS-записями через локальный DNS API"
        actions={
          <Button size="sm" onClick={openDialog}>
            <Plus className="h-4 w-4" /> Добавить
          </Button>
        }
      />

      <div className="flex items-center gap-2 rounded-md border border-blue-200 bg-blue-50 px-4 py-2.5 text-sm text-blue-800 dark:border-blue-900 dark:bg-blue-950 dark:text-blue-300">
        <Info className="h-4 w-4 shrink-0" />
        <span>Записи сохраняются в конфиг репозитория. Для применения закоммитьте и запушьте на странице <strong>Git</strong>.</span>
      </div>

      {isLoading ? (
        <div className="space-y-3">
          {Array.from({ length: 5 }).map((_, i) => <Skeleton key={i} className="h-12 w-full" />)}
        </div>
      ) : !records?.length ? (
        <EmptyState
          icon={Globe}
          title="Нет DNS-записей"
          description="Создайте первую запись"
          action={<Button onClick={openDialog}><Plus className="h-4 w-4" /> Добавить</Button>}
        />
      ) : (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Поддомен</TableHead>
              <TableHead>Домен</TableHead>
              <TableHead>Тип</TableHead>
              <TableHead>IP</TableHead>
              <TableHead className="w-20">Действия</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {records.map((r) => (
              <TableRow key={r.id}>
                <TableCell className="font-medium">{r.subdomain || '@'}</TableCell>
                <TableCell>{r.domain}</TableCell>
                <TableCell><Badge variant="outline">{r.type}</Badge></TableCell>
                <TableCell className="font-mono text-sm">{r.ip}</TableCell>
                <TableCell>
                  <Button variant="ghost" size="icon" onClick={() => setDeleteTarget(r.id)}>
                    <Trash2 className="h-4 w-4 text-destructive" />
                  </Button>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}

      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogHeader>
          <DialogTitle>Добавить DNS-запись</DialogTitle>
          <DialogDescription>Создайте новую DNS-запись</DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          <Input placeholder="Поддомен (например, analytics.dev)" value={form.subdomain} onChange={(e) => setForm({ ...form, subdomain: e.target.value })} />
          <Input placeholder="Домен (borisovai.ru)" value={form.domain} onChange={(e) => setForm({ ...form, domain: e.target.value })} />
          <Input placeholder="Тип (A, CNAME, TXT...)" value={form.type} onChange={(e) => setForm({ ...form, type: e.target.value })} />
          <Input placeholder="IP / Значение *" value={form.ip} onChange={(e) => setForm({ ...form, ip: e.target.value })} />
          {formError && (
            <div className="flex items-center gap-1.5 text-sm text-destructive">
              <AlertCircle className="h-3.5 w-3.5 shrink-0" />
              {formError}
            </div>
          )}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => setDialogOpen(false)}>Отмена</Button>
          <Button onClick={handleCreate} disabled={createDns.isPending || !form.ip}>
            {createDns.isPending ? 'Создание...' : 'Создать'}
          </Button>
        </DialogFooter>
      </Dialog>

      <ConfirmDialog
        open={!!deleteTarget}
        onOpenChange={(v) => !v && setDeleteTarget(null)}
        title="Удалить запись"
        description="Вы уверены? DNS-запись будет удалена."
        onConfirm={handleDelete}
        loading={deleteDns.isPending}
      />
    </>
  );
}
