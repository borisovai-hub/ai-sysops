import { useState } from 'react';
import { toast } from 'sonner';
import { Folder, File, FolderPlus, Trash2, ChevronRight, Home, AlertCircle } from 'lucide-react';
import { PageHeader } from '@/components/layout/PageHeader';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Table, TableHeader, TableBody, TableRow, TableHead, TableCell } from '@/components/ui/table';
import { Dialog, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from '@/components/ui/dialog';
import { Skeleton } from '@/components/ui/skeleton';
import { EmptyState } from '@/components/feedback/EmptyState';
import { ConfirmDialog } from '@/components/feedback/ConfirmDialog';
import { RelativeTime } from '@/components/shared/RelativeTime';
import { useFileBrowse } from '@/api/queries/files';
import { useDeleteFile, useCreateDir } from '@/api/mutations/files';
import { ApiError } from '@/api/client';

function formatSize(bytes: number): string {
  if (bytes === 0) return '---';
  const units = ['B', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(1024));
  return `${(bytes / Math.pow(1024, i)).toFixed(i > 0 ? 1 : 0)} ${units[i]}`;
}

export function FilesPage() {
  const [currentPath, setCurrentPath] = useState('/');
  const { data: files, isLoading } = useFileBrowse(currentPath);
  const deleteFile = useDeleteFile();
  const createDir = useCreateDir();

  const [mkdirOpen, setMkdirOpen] = useState(false);
  const [dirName, setDirName] = useState('');
  const [formError, setFormError] = useState('');
  const [deleteTarget, setDeleteTarget] = useState<string | null>(null);

  const segments = currentPath.split('/').filter(Boolean);

  const buildPath = (name: string) =>
    currentPath === '/' ? `/${name}` : `${currentPath}/${name}`;

  const navigateTo = (path: string) => setCurrentPath(path);

  const handleBreadcrumb = (index: number) => {
    const path = '/' + segments.slice(0, index + 1).join('/');
    setCurrentPath(path);
  };

  const openMkdir = () => {
    setDirName('');
    setFormError('');
    createDir.reset();
    setMkdirOpen(true);
  };

  const handleMkdir = () => {
    setFormError('');
    if (!dirName.trim()) {
      setFormError('Введите имя папки');
      return;
    }
    createDir.mutate(
      { path: currentPath, name: dirName },
      {
        onSuccess: () => {
          setMkdirOpen(false);
          setDirName('');
          toast.success('Папка создана');
        },
        onError: (err) => {
          setFormError(err instanceof ApiError ? err.message : 'Ошибка создания папки');
        },
      },
    );
  };

  const handleDelete = () => {
    if (!deleteTarget) return;
    deleteFile.mutate(deleteTarget, {
      onSuccess: () => {
        setDeleteTarget(null);
        toast.success('Удалено');
      },
    });
  };

  return (
    <>
      <PageHeader
        title="Файлы"
        description="Файловый менеджер сервера"
        actions={
          <Button size="sm" onClick={openMkdir}>
            <FolderPlus className="h-4 w-4" /> Создать папку
          </Button>
        }
      />

      {/* Breadcrumbs */}
      <div className="flex items-center gap-1 mb-4 text-sm flex-wrap">
        <Button variant="ghost" size="sm" onClick={() => setCurrentPath('/')}>
          <Home className="h-4 w-4" />
        </Button>
        {segments.map((seg, i) => (
          <div key={i} className="flex items-center gap-1">
            <ChevronRight className="h-3 w-3 text-muted-foreground" />
            <Button
              variant="ghost"
              size="sm"
              className="h-7 px-2"
              onClick={() => handleBreadcrumb(i)}
            >
              {seg}
            </Button>
          </div>
        ))}
      </div>

      {isLoading ? (
        <div className="space-y-3">
          {Array.from({ length: 6 }).map((_, i) => <Skeleton key={i} className="h-12 w-full" />)}
        </div>
      ) : !files?.length ? (
        <EmptyState icon={Folder} title="Папка пуста" description={currentPath} />
      ) : (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Имя</TableHead>
              <TableHead>Размер</TableHead>
              <TableHead>Изменён</TableHead>
              <TableHead className="w-20">Действия</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {files.map((f: any) => (
              <TableRow key={f.name}>
                <TableCell>
                  <div className="flex items-center gap-2">
                    {f.type === 'directory' ? (
                      <Folder className="h-4 w-4 text-accent" />
                    ) : (
                      <File className="h-4 w-4 text-muted-foreground" />
                    )}
                    {f.type === 'directory' ? (
                      <button
                        className="font-medium hover:underline text-left"
                        onClick={() => navigateTo(buildPath(f.name))}
                      >
                        {f.name}
                      </button>
                    ) : (
                      <span className="font-medium">{f.name}</span>
                    )}
                  </div>
                </TableCell>
                <TableCell className="text-sm text-muted-foreground">
                  {f.type === 'directory' ? '---' : formatSize(f.size ?? 0)}
                </TableCell>
                <TableCell>
                  {f.modified ? <RelativeTime date={f.modified} /> : '---'}
                </TableCell>
                <TableCell>
                  <Button variant="ghost" size="icon" onClick={() => setDeleteTarget(buildPath(f.name))}>
                    <Trash2 className="h-4 w-4 text-destructive" />
                  </Button>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}

      <Dialog open={mkdirOpen} onOpenChange={setMkdirOpen}>
        <DialogHeader>
          <DialogTitle>Создать папку</DialogTitle>
          <DialogDescription>В {currentPath}</DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          <Input
            placeholder="Имя папки"
            value={dirName}
            onChange={(e) => setDirName(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && dirName && handleMkdir()}
          />
          {formError && (
            <div className="flex items-center gap-1.5 text-sm text-destructive">
              <AlertCircle className="h-3.5 w-3.5 shrink-0" />
              {formError}
            </div>
          )}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => setMkdirOpen(false)}>Отмена</Button>
          <Button onClick={handleMkdir} disabled={createDir.isPending || !dirName}>
            {createDir.isPending ? 'Создание...' : 'Создать'}
          </Button>
        </DialogFooter>
      </Dialog>

      <ConfirmDialog
        open={!!deleteTarget}
        onOpenChange={(v) => !v && setDeleteTarget(null)}
        title="Удалить файл"
        description={`Удалить "${deleteTarget}"? Это действие необратимо.`}
        onConfirm={handleDelete}
        loading={deleteFile.isPending}
      />
    </>
  );
}
