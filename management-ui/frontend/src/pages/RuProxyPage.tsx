import { useState } from 'react';
import { toast } from 'sonner';
import { Globe2, Plus, Trash2, Pencil, AlertCircle } from 'lucide-react';
import { PageHeader } from '@/components/layout/PageHeader';
import { DashboardGrid } from '@/components/dashboard/DashboardGrid';
import { StatCard } from '@/components/dashboard/StatCard';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Switch } from '@/components/ui/switch';
import { Table, TableHeader, TableBody, TableRow, TableHead, TableCell } from '@/components/ui/table';
import { Dialog, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from '@/components/ui/dialog';
import { Skeleton } from '@/components/ui/skeleton';
import { EmptyState } from '@/components/feedback/EmptyState';
import { ConfirmDialog } from '@/components/feedback/ConfirmDialog';
import { useRuProxyStatus, useRuProxyDomains } from '@/api/queries/ru-proxy';
import { useAddDomain, useDeleteDomain } from '@/api/mutations/ru-proxy';
import { ApiError } from '@/api/client';

interface DomainForm {
  domain: string;
  backend: string;
  enabled: boolean;
}

const emptyForm: DomainForm = { domain: '', backend: '', enabled: true };

export function RuProxyPage() {
  const { data: status } = useRuProxyStatus();
  const { data: domains, isLoading } = useRuProxyDomains();
  const addDomain = useAddDomain();
  const deleteDomain = useDeleteDomain();

  const [dialogOpen, setDialogOpen] = useState(false);
  const [form, setForm] = useState<DomainForm>(emptyForm);
  const [formError, setFormError] = useState('');
  const [deleteTarget, setDeleteTarget] = useState<string | null>(null);

  const isOnline = status?.status === 'running' || status?.status === 'ok';
  const domainCount = domains?.length ?? 0;

  const openDialog = () => {
    setForm(emptyForm);
    setFormError('');
    addDomain.reset();
    setDialogOpen(true);
  };

  const handleCreate = () => {
    setFormError('');
    if (!form.domain || !form.backend) {
      setFormError('Заполните домен и бэкенд');
      return;
    }
    addDomain.mutate(form, {
      onSuccess: (data: any) => {
        setDialogOpen(false);
        setForm(emptyForm);
        if (data?.gitops) {
          toast.success('Домен сохранён', { description: 'Закоммитьте и запушьте на странице Git для деплоя' });
        } else {
          toast.success('Домен добавлен');
        }
      },
      onError: (err) => {
        setFormError(err instanceof ApiError ? err.message : 'Ошибка добавления домена');
      },
    });
  };

  const handleDelete = () => {
    if (!deleteTarget) return;
    deleteDomain.mutate(deleteTarget, {
      onSuccess: (data: any) => {
        setDeleteTarget(null);
        if (data?.gitops) {
          toast.success('Домен удалён', { description: 'Закоммитьте и запушьте на странице Git для деплоя' });
        } else {
          toast.success('Домен удалён');
        }
      },
    });
  };

  return (
    <>
      <PageHeader
        title="RU Proxy"
        description="Caddy reverse proxy для .ru доменов (82.146.56.174)"
        actions={
          <Button size="sm" onClick={openDialog}>
            <Plus className="h-4 w-4" /> Добавить домен
          </Button>
        }
      />

      <DashboardGrid>
        <StatCard label="Статус Caddy" value={isOnline ? 'Online' : 'Offline'} icon={Globe2} variant={isOnline ? 'success' : 'destructive'} />
        <StatCard label="Доменов" value={domainCount} icon={Globe2} />
      </DashboardGrid>

      {isLoading ? (
        <div className="space-y-3">
          {Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} className="h-12 w-full" />)}
        </div>
      ) : !domains?.length ? (
        <EmptyState
          icon={Globe2}
          title="Нет доменов"
          description="Добавьте .ru домен для проксирования"
          action={<Button onClick={openDialog}><Plus className="h-4 w-4" /> Добавить</Button>}
        />
      ) : (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Домен</TableHead>
              <TableHead>Бэкенд</TableHead>
              <TableHead>Статус</TableHead>
              <TableHead className="w-24">Действия</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {domains.map((d: any) => (
              <TableRow key={d.domain}>
                <TableCell className="font-medium">{d.domain}</TableCell>
                <TableCell className="font-mono text-sm">{d.backend}</TableCell>
                <TableCell>
                  {d.enabled !== false ? (
                    <Badge variant="success">Активен</Badge>
                  ) : (
                    <Badge variant="secondary">Отключён</Badge>
                  )}
                </TableCell>
                <TableCell>
                  <div className="flex gap-1">
                    <Button variant="ghost" size="icon"><Pencil className="h-4 w-4" /></Button>
                    <Button variant="ghost" size="icon" onClick={() => setDeleteTarget(d.domain)}>
                      <Trash2 className="h-4 w-4 text-destructive" />
                    </Button>
                  </div>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}

      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogHeader>
          <DialogTitle>Добавить домен</DialogTitle>
          <DialogDescription>Добавить .ru домен в Caddy reverse proxy</DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          <Input placeholder="Домен (admin.borisovai.ru) *" value={form.domain} onChange={(e) => setForm({ ...form, domain: e.target.value })} />
          <Input placeholder="Бэкенд (https://contabo-ip:443) *" value={form.backend} onChange={(e) => setForm({ ...form, backend: e.target.value })} />
          <div className="flex items-center gap-2">
            <Switch checked={form.enabled} onCheckedChange={(v) => setForm({ ...form, enabled: v })} />
            <span className="text-sm">Активен</span>
          </div>
          {formError && (
            <div className="flex items-center gap-1.5 text-sm text-destructive">
              <AlertCircle className="h-3.5 w-3.5 shrink-0" />
              {formError}
            </div>
          )}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => setDialogOpen(false)}>Отмена</Button>
          <Button onClick={handleCreate} disabled={addDomain.isPending || !form.domain}>
            {addDomain.isPending ? 'Добавление...' : 'Добавить'}
          </Button>
        </DialogFooter>
      </Dialog>

      <ConfirmDialog
        open={!!deleteTarget}
        onOpenChange={(v) => !v && setDeleteTarget(null)}
        title="Удалить домен"
        description={`Удалить "${deleteTarget}" из RU Proxy? Домен станет недоступен через .ru.`}
        onConfirm={handleDelete}
        loading={deleteDomain.isPending}
      />
    </>
  );
}
