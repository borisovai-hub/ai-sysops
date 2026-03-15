import { useState } from 'react';
import { toast } from 'sonner';
import { Users, Plus, Trash2, Pencil, AlertCircle, Upload, Download, Info, Bell, Copy, Shield, ShieldCheck } from 'lucide-react';
import { PageHeader } from '@/components/layout/PageHeader';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Table, TableHeader, TableBody, TableRow, TableHead, TableCell } from '@/components/ui/table';
import { Dialog, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from '@/components/ui/dialog';
import { Skeleton } from '@/components/ui/skeleton';
import { EmptyState } from '@/components/feedback/EmptyState';
import { ConfirmDialog } from '@/components/feedback/ConfirmDialog';
import { Card } from '@/components/ui/card';
import { useAutheliaUsers, useNotifications } from '@/api/queries/users';
import { useCreateUser, useUpdateUser, useDeleteUser, useApplyUsers, useSyncUsers } from '@/api/mutations/users';
import { ApiError } from '@/api/client';

interface UserForm {
  username: string;
  displayName: string;
  email: string;
  externalEmail: string;
  password: string;
  confirmPassword: string;
  groups: string;
  authPolicy: 'one_factor' | 'two_factor';
}

const emptyForm: UserForm = {
  username: '', displayName: '', email: '', externalEmail: '',
  password: '', confirmPassword: '', groups: 'admins', authPolicy: 'two_factor',
};

const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function UsersPage() {
  const { data: users, isLoading } = useAutheliaUsers();
  const { data: notifications } = useNotifications();
  const createUser = useCreateUser();
  const updateUser = useUpdateUser();
  const deleteUser = useDeleteUser();
  const applyUsers = useApplyUsers();
  const syncUsers = useSyncUsers();

  const [dialogOpen, setDialogOpen] = useState(false);
  const [editTarget, setEditTarget] = useState<string | null>(null);
  const [form, setForm] = useState<UserForm>(emptyForm);
  const [formError, setFormError] = useState('');
  const [deleteTarget, setDeleteTarget] = useState<string | null>(null);
  const [showNotifications, setShowNotifications] = useState(false);

  const openDialog = () => {
    setEditTarget(null);
    setForm(emptyForm);
    setFormError('');
    createUser.reset();
    setDialogOpen(true);
  };

  const openEdit = (u: any) => {
    setEditTarget(u.username);
    setForm({
      username: u.username,
      displayName: u.displayname || '',
      email: u.email || '',
      externalEmail: u.externalEmail || '',
      password: '',
      confirmPassword: '',
      groups: (u.groups ?? []).join(', '),
      authPolicy: u.authPolicy || 'two_factor',
    });
    setFormError('');
    updateUser.reset();
    setDialogOpen(true);
  };

  const validateForm = (isEdit: boolean): string | null => {
    if (!isEdit && !form.username) return 'Имя пользователя обязательно';
    if (!form.email) return 'Email обязателен';
    if (!EMAIL_REGEX.test(form.email)) return 'Некорректный формат email';
    if (form.externalEmail && !EMAIL_REGEX.test(form.externalEmail)) return 'Некорректный формат внешнего email';
    if (!isEdit && !form.password) return 'Пароль обязателен';
    if (form.password && form.password.length < 8) return 'Пароль должен быть не менее 8 символов';
    if (form.password && form.password !== form.confirmPassword) return 'Пароли не совпадают';
    return null;
  };

  const handleCreate = () => {
    setFormError('');
    const err = validateForm(false);
    if (err) { setFormError(err); return; }
    const payload = {
      ...form,
      displayname: form.displayName,
      groups: form.groups.split(',').map((g) => g.trim()).filter(Boolean),
    };
    createUser.mutate(payload, {
      onSuccess: () => {
        setDialogOpen(false);
        setForm(emptyForm);
        toast.success('Пользователь создан', { description: 'Нажмите «Применить» для записи в конфиг Authelia' });
      },
      onError: (err) => {
        setFormError(err instanceof ApiError ? err.message : 'Ошибка создания пользователя');
      },
    });
  };

  const handleUpdate = () => {
    if (!editTarget) return;
    setFormError('');
    const err = validateForm(true);
    if (err) { setFormError(err); return; }
    const data: Record<string, unknown> = {
      displayname: form.displayName,
      email: form.email,
      externalEmail: form.externalEmail,
      groups: form.groups.split(',').map((g) => g.trim()).filter(Boolean),
      authPolicy: form.authPolicy,
    };
    updateUser.mutate(
      { username: editTarget, data },
      {
        onSuccess: () => {
          setDialogOpen(false);
          setEditTarget(null);
          toast.success('Пользователь обновлён', { description: 'Нажмите «Применить» для записи в конфиг Authelia' });
        },
        onError: (err) => {
          setFormError(err instanceof ApiError ? err.message : 'Ошибка обновления');
        },
      },
    );
  };

  const handleDelete = () => {
    if (!deleteTarget) return;
    deleteUser.mutate(deleteTarget, {
      onSuccess: () => {
        setDeleteTarget(null);
        toast.success('Пользователь удалён', { description: 'Нажмите «Применить» для записи в конфиг Authelia' });
      },
    });
  };

  const handleApply = () => {
    applyUsers.mutate(undefined, {
      onSuccess: (data) => toast.success(data.message),
      onError: (err) => toast.error(err instanceof ApiError ? err.message : 'Ошибка применения'),
    });
  };

  const handleSync = () => {
    syncUsers.mutate(undefined, {
      onSuccess: (data) => toast.success(data.message),
      onError: (err) => toast.error(err instanceof ApiError ? err.message : 'Ошибка синхронизации'),
    });
  };

  const copyToClipboard = (text: string) => {
    navigator.clipboard.writeText(text);
    toast.success('Скопировано в буфер обмена');
  };

  const extractLink = (body: string): string | null => {
    const match = body.match(/https?:\/\/\S+/);
    return match ? match[0] : null;
  };

  const isPending = editTarget ? updateUser.isPending : createUser.isPending;
  const hasNotifications = notifications && notifications.length > 0;

  return (
    <>
      <PageHeader
        title="Пользователи"
        description="Authelia SSO — управление пользователями (изменения в БД, применяются по кнопке)"
        actions={
          <div className="flex gap-2">
            <Button
              size="sm"
              variant={hasNotifications ? 'default' : 'outline'}
              onClick={() => setShowNotifications(!showNotifications)}
            >
              <Bell className="h-4 w-4" />
              {hasNotifications && (
                <span className="ml-1 rounded-full bg-white/20 px-1.5 text-xs">{notifications.length}</span>
              )}
            </Button>
            <Button size="sm" variant="outline" onClick={handleSync} disabled={syncUsers.isPending}>
              <Download className="h-4 w-4" /> {syncUsers.isPending ? 'Синхронизация...' : 'Синхронизировать'}
            </Button>
            <Button size="sm" variant="default" onClick={handleApply} disabled={applyUsers.isPending}>
              <Upload className="h-4 w-4" /> {applyUsers.isPending ? 'Применение...' : 'Применить'}
            </Button>
            <Button size="sm" onClick={openDialog}>
              <Plus className="h-4 w-4" /> Создать
            </Button>
          </div>
        }
      />

      <div className="flex items-center gap-2 rounded-md border border-amber-200 bg-amber-50 px-4 py-2.5 text-sm text-amber-800 dark:border-amber-900 dark:bg-amber-950 dark:text-amber-300">
        <Info className="h-4 w-4 shrink-0" />
        <span>Изменения сохраняются в БД. Нажмите <strong>«Применить»</strong> для записи в конфиг Authelia.</span>
      </div>

      {/* Notifications panel */}
      {showNotifications && (
        <Card className="p-4 space-y-3">
          <h3 className="text-sm font-medium flex items-center gap-2">
            <Bell className="h-4 w-4" />
            Уведомления Authelia (TOTP-ссылки)
          </h3>
          {!hasNotifications ? (
            <p className="text-sm text-muted-foreground">Нет уведомлений. Ссылки для регистрации 2FA появятся здесь после попытки входа пользователя.</p>
          ) : (
            <div className="space-y-2 max-h-80 overflow-y-auto">
              {notifications.map((n, i) => {
                const link = extractLink(n.body);
                return (
                  <div key={i} className="rounded-md border p-3 text-sm space-y-1">
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-2">
                        <Badge variant="secondary">{n.recipientName || n.recipientEmail}</Badge>
                        <span className="text-xs text-muted-foreground">{n.date}</span>
                      </div>
                      {link && (
                        <Button size="sm" variant="outline" onClick={() => copyToClipboard(link)}>
                          <Copy className="h-3 w-3 mr-1" /> Копировать ссылку
                        </Button>
                      )}
                    </div>
                    <p className="text-xs font-medium">{n.subject}</p>
                    <pre className="text-xs text-muted-foreground whitespace-pre-wrap break-all bg-muted p-2 rounded max-h-24 overflow-y-auto">{n.body}</pre>
                  </div>
                );
              })}
            </div>
          )}
        </Card>
      )}

      {isLoading ? (
        <div className="space-y-3">
          {Array.from({ length: 3 }).map((_, i) => <Skeleton key={i} className="h-12 w-full" />)}
        </div>
      ) : !users?.length ? (
        <EmptyState
          icon={Users}
          title="Нет пользователей"
          description="Создайте первого пользователя или синхронизируйте из конфига Authelia"
          action={
            <div className="flex gap-2">
              <Button variant="outline" onClick={handleSync} disabled={syncUsers.isPending}>
                <Download className="h-4 w-4" /> Синхронизировать
              </Button>
              <Button onClick={openDialog}><Plus className="h-4 w-4" /> Создать</Button>
            </div>
          }
        />
      ) : (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Имя пользователя</TableHead>
              <TableHead>Отображаемое имя</TableHead>
              <TableHead>Email</TableHead>
              <TableHead>Внешний Email</TableHead>
              <TableHead>Группы</TableHead>
              <TableHead>Аутентификация</TableHead>
              <TableHead className="w-24">Действия</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {users.map((u: any) => (
              <TableRow key={u.username}>
                <TableCell className="font-medium">{u.username}</TableCell>
                <TableCell>{u.displayname ?? '---'}</TableCell>
                <TableCell className="text-xs">{u.email || '---'}</TableCell>
                <TableCell className="text-xs">{u.externalEmail || <span className="text-muted-foreground">---</span>}</TableCell>
                <TableCell>
                  <div className="flex gap-1 flex-wrap">
                    {(u.groups ?? []).map((g: string) => (
                      <Badge key={g} variant="secondary">{g}</Badge>
                    ))}
                  </div>
                </TableCell>
                <TableCell>
                  {u.authPolicy === 'one_factor' ? (
                    <Badge variant="outline" className="gap-1"><Shield className="h-3 w-3" /> 1FA</Badge>
                  ) : (
                    <Badge variant="secondary" className="gap-1"><ShieldCheck className="h-3 w-3" /> 2FA</Badge>
                  )}
                </TableCell>
                <TableCell>
                  <div className="flex gap-1">
                    <Button variant="ghost" size="icon" onClick={() => openEdit(u)}><Pencil className="h-4 w-4" /></Button>
                    <Button variant="ghost" size="icon" onClick={() => setDeleteTarget(u.username)}>
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
          <DialogTitle>{editTarget ? 'Редактировать пользователя' : 'Создать пользователя'}</DialogTitle>
          <DialogDescription>
            {editTarget ? `Редактирование пользователя «${editTarget}»` : 'Новый пользователь Authelia SSO (сохраняется в БД)'}
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          <Input
            placeholder="Имя пользователя * (a-z, 0-9, ._-)"
            value={form.username}
            disabled={!!editTarget}
            onChange={(e) => setForm({ ...form, username: e.target.value.toLowerCase().replace(/[^a-z0-9._-]/g, '') })}
          />
          <Input
            placeholder="Отображаемое имя"
            value={form.displayName}
            onChange={(e) => setForm({ ...form, displayName: e.target.value })}
          />
          <Input
            placeholder="Email * (внутренний, для Authelia)"
            type="email"
            value={form.email}
            onChange={(e) => setForm({ ...form, email: e.target.value })}
          />
          <Input
            placeholder="Внешний Email (gmail, yandex — для получения 2FA ссылки)"
            type="email"
            value={form.externalEmail}
            onChange={(e) => setForm({ ...form, externalEmail: e.target.value })}
          />
          {!editTarget && (
            <>
              <Input
                placeholder="Пароль * (мин. 8 символов)"
                type="password"
                value={form.password}
                onChange={(e) => setForm({ ...form, password: e.target.value })}
              />
              <Input
                placeholder="Подтверждение пароля *"
                type="password"
                value={form.confirmPassword}
                onChange={(e) => setForm({ ...form, confirmPassword: e.target.value })}
              />
            </>
          )}
          <Input
            placeholder="Группы (через запятую)"
            value={form.groups}
            onChange={(e) => setForm({ ...form, groups: e.target.value })}
          />
          {/* Auth policy toggle */}
          <div className="flex items-center gap-3 rounded-md border p-3">
            <span className="text-sm font-medium">Аутентификация:</span>
            <div className="flex gap-2">
              <Button
                type="button"
                size="sm"
                variant={form.authPolicy === 'two_factor' ? 'default' : 'outline'}
                onClick={() => setForm({ ...form, authPolicy: 'two_factor' })}
              >
                <ShieldCheck className="h-3 w-3 mr-1" /> 2FA (TOTP)
              </Button>
              <Button
                type="button"
                size="sm"
                variant={form.authPolicy === 'one_factor' ? 'default' : 'outline'}
                onClick={() => setForm({ ...form, authPolicy: 'one_factor' })}
              >
                <Shield className="h-3 w-3 mr-1" /> Только пароль
              </Button>
            </div>
          </div>
          {form.authPolicy === 'one_factor' && (
            <div className="flex items-center gap-1.5 text-sm text-amber-600 dark:text-amber-400">
              <AlertCircle className="h-3.5 w-3.5 shrink-0" />
              Однофакторная аутентификация менее безопасна. Рекомендуется 2FA.
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
            <Button onClick={handleUpdate} disabled={isPending || !form.email}>
              {isPending ? 'Сохранение...' : 'Сохранить'}
            </Button>
          ) : (
            <Button onClick={handleCreate} disabled={isPending || !form.username || !form.email}>
              {isPending ? 'Создание...' : 'Создать'}
            </Button>
          )}
        </DialogFooter>
      </Dialog>

      <ConfirmDialog
        open={!!deleteTarget}
        onOpenChange={(v) => !v && setDeleteTarget(null)}
        title="Удалить пользователя"
        description={`Удалить пользователя "${deleteTarget}"? Изменение применится после нажатия «Применить».`}
        onConfirm={handleDelete}
        loading={deleteUser.isPending}
      />
    </>
  );
}
