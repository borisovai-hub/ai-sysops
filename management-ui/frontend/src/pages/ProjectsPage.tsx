import { useState } from 'react';
import { toast } from 'sonner';
import { FolderGit2, Trash2, RotateCcw, Plus, AlertCircle } from 'lucide-react';
import { PageHeader } from '@/components/layout/PageHeader';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Table, TableHeader, TableBody, TableRow, TableHead, TableCell } from '@/components/ui/table';
import { Dialog, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from '@/components/ui/dialog';
import { Skeleton } from '@/components/ui/skeleton';
import { EmptyState } from '@/components/feedback/EmptyState';
import { ConfirmDialog } from '@/components/feedback/ConfirmDialog';
import { StatusBadge } from '@/components/status/StatusBadge';
import { useProjects, usePublishConfig, useGitlabProjects } from '@/api/queries/projects';
import { usePublishProject, useDeleteProject, useRetryProject } from '@/api/mutations/projects';
import { ApiError } from '@/api/client';

interface PublishForm {
  slug: string;
  type: string;
  gitlabProject: string;
  title: string;
}

const emptyForm: PublishForm = { slug: '', type: 'deploy', gitlabProject: '', title: '' };
const typeLabels: Record<string, string> = { deploy: 'Deploy', docs: 'Docs', infra: 'Infra', product: 'Product' };

export function ProjectsPage() {
  const { data: projects, isLoading } = useProjects();
  const publishProject = usePublishProject();
  const deleteProject = useDeleteProject();
  const retryProject = useRetryProject();

  const [dialogOpen, setDialogOpen] = useState(false);
  const [form, setForm] = useState<PublishForm>(emptyForm);
  const [formError, setFormError] = useState('');
  const [deleteSlug, setDeleteSlug] = useState<string | null>(null);

  const openDialog = () => {
    setForm(emptyForm);
    setFormError('');
    publishProject.reset();
    setDialogOpen(true);
  };

  const handlePublish = () => {
    setFormError('');
    if (!form.slug) {
      setFormError('Укажите slug проекта');
      return;
    }
    publishProject.mutate(form, {
      onSuccess: () => {
        setDialogOpen(false);
        setForm(emptyForm);
        toast.success('Проект опубликован');
      },
      onError: (err) => {
        setFormError(err instanceof ApiError ? err.message : 'Ошибка публикации');
      },
    });
  };

  const handleDelete = () => {
    if (!deleteSlug) return;
    deleteProject.mutate(deleteSlug, {
      onSuccess: () => {
        setDeleteSlug(null);
        toast.success('Проект удалён');
      },
    });
  };

  const statusMap = (status: string) => {
    if (status === 'ok' || status === 'deployed') return 'running';
    if (status === 'error' || status === 'failed') return 'error';
    if (status === 'pending' || status === 'in_progress') return 'partial';
    return 'unknown';
  };

  return (
    <>
      <PageHeader
        title="Проекты"
        description="One-Click Publish: DNS + Traefik + CI/CD + Strapi"
        actions={
          <Button size="sm" onClick={openDialog}>
            <Plus className="h-4 w-4" /> Опубликовать
          </Button>
        }
      />

      {isLoading ? (
        <div className="space-y-3">
          {Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} className="h-12 w-full" />)}
        </div>
      ) : !projects?.length ? (
        <EmptyState
          icon={FolderGit2}
          title="Нет проектов"
          description="Опубликуйте первый проект"
          action={<Button onClick={openDialog}><Plus className="h-4 w-4" /> Опубликовать</Button>}
        />
      ) : (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Slug</TableHead>
              <TableHead>Тип</TableHead>
              <TableHead>Домен</TableHead>
              <TableHead>Название</TableHead>
              <TableHead>Статус</TableHead>
              <TableHead className="w-24">Действия</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {projects.map((p: any) => (
              <TableRow key={p.slug}>
                <TableCell className="font-medium font-mono">{p.slug}</TableCell>
                <TableCell>{typeLabels[p.type] ?? p.type}</TableCell>
                <TableCell className="text-sm">{p.domain ?? '---'}</TableCell>
                <TableCell>{p.title ?? '---'}</TableCell>
                <TableCell>
                  <StatusBadge status={statusMap(p.status ?? 'unknown')} label={p.status ?? 'unknown'} />
                </TableCell>
                <TableCell>
                  <div className="flex gap-1">
                    <Button
                      variant="ghost"
                      size="icon"
                      title="Повторить"
                      onClick={() => retryProject.mutate(p.slug, { onSuccess: () => toast.success('Повторный запуск') })}
                      disabled={retryProject.isPending}
                    >
                      <RotateCcw className="h-4 w-4" />
                    </Button>
                    <Button variant="ghost" size="icon" onClick={() => setDeleteSlug(p.slug)}>
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
          <DialogTitle>Опубликовать проект</DialogTitle>
          <DialogDescription>Настройка DNS, Traefik, CI/CD и Strapi за один шаг</DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          <Input placeholder="Slug (например, my-app)" value={form.slug} onChange={(e) => setForm({ ...form, slug: e.target.value })} />
          <select
            className="flex h-9 w-full rounded-lg border border-border bg-background px-3 py-1 text-sm"
            value={form.type}
            onChange={(e) => setForm({ ...form, type: e.target.value })}
          >
            <option value="deploy">Deploy (DNS + Traefik + CI)</option>
            <option value="docs">Docs (Strapi + CI)</option>
            <option value="infra">Infra (CI only)</option>
            <option value="product">Product (Strapi + CI + directories)</option>
          </select>
          <Input placeholder="GitLab проект (group/name)" value={form.gitlabProject} onChange={(e) => setForm({ ...form, gitlabProject: e.target.value })} />
          <Input placeholder="Название" value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} />
          {formError && (
            <div className="flex items-center gap-1.5 text-sm text-destructive">
              <AlertCircle className="h-3.5 w-3.5 shrink-0" />
              {formError}
            </div>
          )}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => setDialogOpen(false)}>Отмена</Button>
          <Button onClick={handlePublish} disabled={publishProject.isPending || !form.slug}>
            {publishProject.isPending ? 'Публикация...' : 'Опубликовать'}
          </Button>
        </DialogFooter>
      </Dialog>

      <ConfirmDialog
        open={!!deleteSlug}
        onOpenChange={(v) => !v && setDeleteSlug(null)}
        title="Удалить проект"
        description={`Удалить проект "${deleteSlug}"? Будут удалены Traefik-конфиг, DNS-записи и CI.`}
        onConfirm={handleDelete}
        loading={deleteProject.isPending}
      />
    </>
  );
}
