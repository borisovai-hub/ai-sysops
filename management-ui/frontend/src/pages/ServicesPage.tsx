import { useState } from 'react';
import { toast } from 'sonner';
import { Server, Shield, Activity, Plus, Trash2, Pencil, RefreshCw, AlertCircle, Info } from 'lucide-react';
import { PageHeader } from '@/components/layout/PageHeader';
import { DashboardGrid } from '@/components/dashboard/DashboardGrid';
import { StatCard } from '@/components/dashboard/StatCard';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Switch } from '@/components/ui/switch';
import { Table, TableHeader, TableBody, TableRow, TableHead, TableCell } from '@/components/ui/table';
import { Dialog, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from '@/components/ui/dialog';
import { Skeleton } from '@/components/ui/skeleton';
import { EmptyState } from '@/components/feedback/EmptyState';
import { ConfirmDialog } from '@/components/feedback/ConfirmDialog';
import { useServices, useTraefikStatus } from '@/api/queries/services';
import { useCreateService, useUpdateService, useDeleteService } from '@/api/mutations/services';
import { ApiError } from '@/api/client';

interface ServiceForm {
  name: string;
  domain: string;
  port: string;
  internalIp: string;
  authelia: boolean;
}

const emptyForm: ServiceForm = { name: '', domain: '', port: '', internalIp: '127.0.0.1', authelia: false };

export function ServicesPage() {
  const { data: services, isLoading } = useServices();
  const { data: traefik } = useTraefikStatus();
  const createService = useCreateService();
  const updateService = useUpdateService();
  const deleteService = useDeleteService();

  const [dialogOpen, setDialogOpen] = useState(false);
  const [editTarget, setEditTarget] = useState<string | null>(null);
  const [form, setForm] = useState<ServiceForm>(emptyForm);
  const [formError, setFormError] = useState('');
  const [deleteTarget, setDeleteTarget] = useState<string | null>(null);

  const total = services?.length ?? 0;
  const withAuthelia = services?.filter((s) => s.configFile?.includes('authelia')).length ?? 0;
  const traefikStatus = traefik?.status ?? 'unknown';

  const openDialog = () => {
    setEditTarget(null);
    setForm(emptyForm);
    setFormError('');
    createService.reset();
    setDialogOpen(true);
  };

  const openEdit = (s: { name: string; domain: string; port: string; internalIp: string; configFile: string }) => {
    setEditTarget(s.name);
    setForm({
      name: s.name,
      domain: s.domain,
      port: s.port,
      internalIp: s.internalIp || '127.0.0.1',
      authelia: s.configFile?.includes('authelia') ?? false,
    });
    setFormError('');
    updateService.reset();
    setDialogOpen(true);
  };

  const handleCreate = () => {
    setFormError('');
    if (!form.name || !form.internalIp || !form.port) {
      setFormError('Заполните обязательные поля: имя, IP и порт');
      return;
    }
    createService.mutate(form, {
      onSuccess: (data: any) => {
        setDialogOpen(false);
        setForm(emptyForm);
        if (data?.gitops) {
          toast.success('Сервис сохранён', { description: 'Закоммитьте и запушьте на странице Git для деплоя' });
        } else {
          toast.success('Сервис создан');
        }
      },
      onError: (err) => {
        setFormError(err instanceof ApiError ? err.message : 'Ошибка создания сервиса');
      },
    });
  };

  const handleUpdate = () => {
    if (!editTarget) return;
    setFormError('');
    if (!form.internalIp || !form.port) {
      setFormError('Заполните обязательные поля: IP и порт');
      return;
    }
    updateService.mutate(
      { name: editTarget, data: { internalIp: form.internalIp, port: form.port, domain: form.domain } },
      {
        onSuccess: (data: any) => {
          setDialogOpen(false);
          setEditTarget(null);
          if (data?.gitops) {
            toast.success('Сервис обновлён', { description: 'Закоммитьте и запушьте на странице Git для деплоя' });
          } else {
            toast.success('Сервис обновлён');
          }
        },
        onError: (err) => {
          setFormError(err instanceof ApiError ? err.message : 'Ошибка обновления сервиса');
        },
      },
    );
  };

  const handleDelete = () => {
    if (!deleteTarget) return;
    deleteService.mutate(deleteTarget, {
      onSuccess: () => {
        setDeleteTarget(null);
        toast.success('Сервис удалён');
      },
    });
  };

  return (
    <>
      <PageHeader
        title="Сервисы"
        description="Управление Traefik-роутерами"
        actions={
          <>
            <Button variant="outline" size="sm" onClick={() => window.location.reload()}>
              <RefreshCw className="h-4 w-4" />
            </Button>
            <Button size="sm" onClick={openDialog}>
              <Plus className="h-4 w-4" /> Добавить
            </Button>
          </>
        }
      />

      <DashboardGrid>
        <StatCard label="Всего сервисов" value={total} icon={Server} />
        <StatCard label="Запущено" value={total} icon={Activity} variant="success" />
        <StatCard label="С Authelia" value={withAuthelia} icon={Shield} />
        <StatCard label="Traefik" value={traefikStatus} icon={Server} variant={traefikStatus === 'running' ? 'success' : 'warning'} />
      </DashboardGrid>

      <div className="flex items-center gap-2 rounded-md border border-blue-200 bg-blue-50 px-4 py-2.5 text-sm text-blue-800 dark:border-blue-900 dark:bg-blue-950 dark:text-blue-300">
        <Info className="h-4 w-4 shrink-0" />
        <span>Изменения сохраняются в репозиторий. Для применения закоммитьте и запушьте на странице <strong>Git</strong>.</span>
      </div>

      {isLoading ? (
        <div className="space-y-3">
          {Array.from({ length: 5 }).map((_, i) => <Skeleton key={i} className="h-12 w-full" />)}
        </div>
      ) : !services?.length ? (
        <EmptyState icon={Server} title="Нет сервисов" description="Добавьте первый сервис" action={<Button onClick={openDialog}><Plus className="h-4 w-4" /> Добавить</Button>} />
      ) : (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Имя</TableHead>
              <TableHead>Домен</TableHead>
              <TableHead>Порт</TableHead>
              <TableHead>Authelia</TableHead>
              <TableHead className="w-24">Действия</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {services.map((s) => (
              <TableRow key={s.name}>
                <TableCell className="font-medium">{s.name}</TableCell>
                <TableCell>{s.domain}</TableCell>
                <TableCell>{s.port}</TableCell>
                <TableCell>
                  {s.configFile?.includes('authelia') ? (
                    <Badge variant="success">Да</Badge>
                  ) : (
                    <Badge variant="secondary">Нет</Badge>
                  )}
                </TableCell>
                <TableCell>
                  <div className="flex gap-1">
                    <Button variant="ghost" size="icon" onClick={() => openEdit(s)}><Pencil className="h-4 w-4" /></Button>
                    <Button variant="ghost" size="icon" onClick={() => setDeleteTarget(s.name)}>
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
          <DialogTitle>{editTarget ? 'Редактировать сервис' : 'Добавить сервис'}</DialogTitle>
          <DialogDescription>
            {editTarget ? `Редактирование Traefik-роутера «${editTarget}»` : 'Создайте Traefik-роутер для нового сервиса'}
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          <Input placeholder="Имя (slug) *" value={form.name} disabled={!!editTarget} onChange={(e) => setForm({ ...form, name: e.target.value })} />
          <Input placeholder="Домен (авто-определяется)" value={form.domain} onChange={(e) => setForm({ ...form, domain: e.target.value })} />
          <Input placeholder="Порт *" value={form.port} onChange={(e) => setForm({ ...form, port: e.target.value })} />
          <Input placeholder="IP (127.0.0.1) *" value={form.internalIp} onChange={(e) => setForm({ ...form, internalIp: e.target.value })} />
          {!editTarget && (
            <div className="flex items-center gap-2">
              <Switch checked={form.authelia} onCheckedChange={(v) => setForm({ ...form, authelia: v })} />
              <span className="text-sm">Authelia (SSO)</span>
            </div>
          )}
          {formError && (
            <div className="flex items-center gap-1.5 text-sm text-destructive">
              <AlertCircle className="h-3.5 w-3.5 shrink-0" />
              {formError}
            </div>
          )}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => setDialogOpen(false)}>Отмена</Button>
          {editTarget ? (
            <Button onClick={handleUpdate} disabled={updateService.isPending || !form.internalIp || !form.port}>
              {updateService.isPending ? 'Сохранение...' : 'Сохранить'}
            </Button>
          ) : (
            <Button onClick={handleCreate} disabled={createService.isPending || !form.name}>
              {createService.isPending ? 'Создание...' : 'Создать'}
            </Button>
          )}
        </DialogFooter>
      </Dialog>

      <ConfirmDialog
        open={!!deleteTarget}
        onOpenChange={(v) => !v && setDeleteTarget(null)}
        title="Удалить сервис"
        description={`Удалить роутер "${deleteTarget}"? Это действие необратимо.`}
        onConfirm={handleDelete}
        loading={deleteService.isPending}
      />
    </>
  );
}
