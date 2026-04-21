import { useState, useRef } from 'react';
import { toast } from 'sonner';
import {
  Package2, Plus, Download, Upload, Trash2, CheckCircle2, XCircle, Loader2,
  Undo2, FileArchive,
} from 'lucide-react';
import { PageHeader } from '@/components/layout/PageHeader';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Table, TableHeader, TableBody, TableRow, TableHead, TableCell } from '@/components/ui/table';
import { Dialog, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from '@/components/ui/dialog';
import { Skeleton } from '@/components/ui/skeleton';
import { ConfirmDialog } from '@/components/feedback/ConfirmDialog';
import { useReleases } from '@/api/queries/publish';
import {
  useCreateRelease, usePatchRelease, useDeleteRelease,
} from '@/api/mutations/publish';
import { chunkedUpload } from '@/api/publishUpload';
import { ApiError } from '@/api/client';

const statusColors: Record<string, string> = {
  published: 'bg-emerald-500/10 text-emerald-600 border-emerald-400/30',
  draft: 'bg-slate-500/10 text-slate-600 border-slate-400/30',
  unpublished: 'bg-amber-500/10 text-amber-600 border-amber-400/30',
  skipped: 'bg-muted text-muted-foreground',
};

export function ReleasesPage() {
  const [slug, setSlug] = useState('');
  const [activeSlug, setActiveSlug] = useState<string | null>(null);
  const [createOpen, setCreateOpen] = useState(false);
  const [deleteVersion, setDeleteVersion] = useState<string | null>(null);

  const { data, isLoading } = useReleases(activeSlug);
  const patchMut = usePatchRelease();
  const deleteMut = useDeleteRelease();

  const load = () => {
    const s = slug.trim();
    if (!s) return toast.error('Укажите slug проекта');
    setActiveSlug(s);
  };

  const togglePublish = (version: string, current: string | null | undefined) => {
    const action = current === 'published' ? 'unpublish' : 'publish';
    if (!activeSlug) return;
    patchMut.mutate(
      { slug: activeSlug, version, action },
      {
        onSuccess: () => toast.success(`${version}: ${action}`),
        onError: (err) => toast.error(err instanceof ApiError ? err.message : 'Ошибка'),
      },
    );
  };

  const confirmDelete = () => {
    if (!activeSlug || !deleteVersion) return;
    deleteMut.mutate(
      { slug: activeSlug, version: deleteVersion, removeArtifacts: true, removeStrapi: false },
      {
        onSuccess: () => {
          toast.success(`${deleteVersion} удалён`);
          setDeleteVersion(null);
        },
        onError: (err) => toast.error(err instanceof ApiError ? err.message : 'Ошибка'),
      },
    );
  };

  return (
    <div className="flex flex-col gap-4">
      <PageHeader
        title="Релизы"
        description="Версии проектов с артефактами, публикация на сайте и загрузка файлов"
        actions={
          <div className="flex items-center gap-2">
            <Input
              placeholder="Slug проекта"
              value={slug}
              onChange={(e) => setSlug(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && load()}
              className="w-[200px]"
            />
            <Button size="sm" variant="outline" onClick={load}>Загрузить</Button>
            <Button size="sm" onClick={() => setCreateOpen(true)} disabled={!activeSlug}>
              <Plus className="h-4 w-4 mr-1" /> Новый релиз
            </Button>
          </div>
        }
      />

      {!activeSlug && (
        <Card>
          <CardContent className="p-8 text-center text-muted-foreground">
            Укажите slug проекта и нажмите «Загрузить» для просмотра истории релизов.
          </CardContent>
        </Card>
      )}

      {activeSlug && (
        <Card>
          <CardContent className="p-0">
            <div className="p-3 border-b border-border flex items-center justify-between text-sm">
              <div>
                <span className="text-muted-foreground">slug:</span> <code className="font-mono">{activeSlug}</code>
                {data?.current && (
                  <>
                    <span className="mx-2 text-muted-foreground">|</span>
                    <span className="text-muted-foreground">current:</span> <Badge>{data.current}</Badge>
                  </>
                )}
              </div>
              <span className="text-xs text-muted-foreground">{data?.releases.length ?? 0} релиз(ов)</span>
            </div>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Версия</TableHead>
                  <TableHead>Strapi</TableHead>
                  <TableHead>Источник</TableHead>
                  <TableHead>Артефакты</TableHead>
                  <TableHead>Changelog</TableHead>
                  <TableHead>Дата</TableHead>
                  <TableHead className="text-right">Действия</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {isLoading && [...Array(3)].map((_, i) => (
                  <TableRow key={i}><TableCell colSpan={7}><Skeleton className="h-6 w-full" /></TableCell></TableRow>
                ))}
                {!isLoading && data?.releases.length === 0 && (
                  <TableRow><TableCell colSpan={7} className="text-center text-muted-foreground py-8">Нет релизов</TableCell></TableRow>
                )}
                {data?.releases.map(r => (
                  <TableRow key={r.version}>
                    <TableCell className="font-medium">
                      {r.version}
                      {r.setAsCurrent && <Badge variant="outline" className="ml-2 text-xs">current</Badge>}
                    </TableCell>
                    <TableCell>
                      <Badge className={statusColors[r.strapiStatus ?? 'skipped']}>{r.strapiStatus ?? 'skipped'}</Badge>
                    </TableCell>
                    <TableCell className="text-xs text-muted-foreground">{r.source}</TableCell>
                    <TableCell>
                      <Badge variant="outline"><FileArchive className="h-3 w-3 mr-1" />{r.artifactsCount}</Badge>
                    </TableCell>
                    <TableCell className="max-w-[280px] truncate text-xs text-muted-foreground" title={r.changelog}>{r.changelog}</TableCell>
                    <TableCell className="text-xs text-muted-foreground">{new Date(r.releasedAt).toLocaleString('ru')}</TableCell>
                    <TableCell className="text-right">
                      <div className="inline-flex gap-1">
                        <Button
                          size="sm"
                          variant="ghost"
                          onClick={() => togglePublish(r.version, r.strapiStatus)}
                          title={r.strapiStatus === 'published' ? 'Снять публикацию' : 'Опубликовать на сайте'}
                          disabled={patchMut.isPending}
                        >
                          {r.strapiStatus === 'published'
                            ? <Undo2 className="h-4 w-4" />
                            : <CheckCircle2 className="h-4 w-4" />}
                        </Button>
                        <Button size="sm" variant="ghost" onClick={() => setDeleteVersion(r.version)} title="Удалить релиз">
                          <Trash2 className="h-4 w-4 text-red-500" />
                        </Button>
                      </div>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      )}

      {createOpen && activeSlug && (
        <CreateReleaseDialog slug={activeSlug} onClose={() => setCreateOpen(false)} />
      )}
      <ConfirmDialog
        open={!!deleteVersion}
        onOpenChange={(v) => !v && setDeleteVersion(null)}
        title={`Удалить релиз ${deleteVersion}?`}
        description="Артефакты будут удалены из /var/www. Strapi entry останется (чтобы удалить — используйте SQL или rollback прогона)."
        confirmLabel="Удалить"
        onConfirm={confirmDelete}
        loading={deleteMut.isPending}
        destructive
      />
    </div>
  );
}

// --- CreateReleaseDialog + chunked upload ---

interface PlannedArtifact {
  file: File;
  label: string;
  platform: string;
  uploadHandle?: string;
  downloadUrl?: string;
  checksumSha256?: string;
  progress?: number;
  uploading?: boolean;
  error?: string;
}

function CreateReleaseDialog({ slug, onClose }: { slug: string; onClose: () => void }) {
  const [version, setVersion] = useState('');
  const [changelog, setChangelog] = useState('');
  const [publishToSite, setPublishToSite] = useState(false);
  const [setAsCurrent, setSetAsCurrent] = useState(true);
  const [artifacts, setArtifacts] = useState<PlannedArtifact[]>([]);
  const [submitting, setSubmitting] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const abortRef = useRef<AbortController | null>(null);
  const createMut = useCreateRelease();

  const addFiles = (list: FileList | null) => {
    if (!list) return;
    const next: PlannedArtifact[] = [];
    for (const f of Array.from(list)) {
      next.push({ file: f, label: f.name, platform: '' });
    }
    setArtifacts(prev => [...prev, ...next]);
  };

  const uploadArtifact = async (idx: number) => {
    const a = artifacts[idx];
    if (!a || a.uploadHandle || !version) {
      if (!version) toast.error('Укажите версию перед загрузкой');
      return;
    }
    setArtifacts(prev => prev.map((x, i) => i === idx ? { ...x, uploading: true, progress: 0, error: undefined } : x));
    const ctl = new AbortController();
    abortRef.current = ctl;
    try {
      const res = await chunkedUpload({
        slug, version, file: a.file,
        signal: ctl.signal,
        onProgress: (received, total) => {
          setArtifacts(prev => prev.map((x, i) => i === idx ? { ...x, progress: Math.round(received / total * 100) } : x));
        },
      });
      setArtifacts(prev => prev.map((x, i) => i === idx ? {
        ...x, uploading: false, progress: 100,
        uploadHandle: res.uploadHandle, downloadUrl: res.downloadUrl,
        checksumSha256: res.checksumSha256,
      } : x));
      toast.success(`${a.file.name}: загружен`);
    } catch (err) {
      setArtifacts(prev => prev.map((x, i) => i === idx ? {
        ...x, uploading: false, error: (err as Error).message,
      } : x));
      toast.error(`${a.file.name}: ${(err as Error).message}`);
    }
  };

  const removeArtifact = (idx: number) => {
    setArtifacts(prev => prev.filter((_, i) => i !== idx));
  };

  const submit = () => {
    if (!version) return toast.error('Укажите версию');
    const unuploaded = artifacts.filter(a => !a.uploadHandle);
    if (artifacts.length > 0 && unuploaded.length > 0) {
      return toast.error(`${unuploaded.length} файл(ов) не загружены. Нажмите «Загрузить» для каждого.`);
    }
    setSubmitting(true);
    createMut.mutate(
      {
        slug,
        body: {
          idempotencyKey: `${slug}-${version}`,
          dryRun: false,
          updateStrapi: true,
          publishToSite,
          release: {
            version, changelog, source: 'admin', action: 'release', setAsCurrent,
            artifacts: artifacts.map(a => ({
              artifact: { uploadHandle: a.uploadHandle, filename: a.file.name, contentType: a.file.type || 'application/octet-stream' },
              storage: { kind: 'downloads', visibility: 'public' },
              label: a.label || undefined,
              platform: a.platform || undefined,
            })),
          },
        },
      },
      {
        onSuccess: () => {
          toast.success(`Релиз ${version} создан`);
          onClose();
        },
        onError: (err) => {
          toast.error(err instanceof ApiError ? err.message : 'Ошибка создания');
          setSubmitting(false);
        },
      },
    );
  };

  return (
    <Dialog open onOpenChange={(v) => !v && onClose()}>
      <DialogHeader>
        <DialogTitle>Создать релиз — {slug}</DialogTitle>
        <DialogDescription>
          Загрузите артефакты (chunked upload) и заполните метаданные. Strapi entry обновляется автоматически.
        </DialogDescription>
      </DialogHeader>

      <div className="flex flex-col gap-3 max-h-[65vh] overflow-auto px-1">
        <div className="grid grid-cols-2 gap-3">
          <label className="text-sm flex flex-col gap-1">
            <span className="text-muted-foreground text-xs">Версия *</span>
            <Input value={version} onChange={(e) => setVersion(e.target.value)} placeholder="v1.0.0" />
          </label>
          <div className="flex items-end gap-4 text-sm">
            <label className="flex items-center gap-2">
              <input type="checkbox" checked={setAsCurrent} onChange={(e) => setSetAsCurrent(e.target.checked)} />
              setAsCurrent
            </label>
            <label className="flex items-center gap-2">
              <input type="checkbox" checked={publishToSite} onChange={(e) => setPublishToSite(e.target.checked)} />
              publishToSite
            </label>
          </div>
        </div>

        <label className="text-sm flex flex-col gap-1">
          <span className="text-muted-foreground text-xs">Changelog</span>
          <textarea
            className="w-full min-h-[80px] rounded-md border border-border bg-background p-2 text-sm resize-y"
            value={changelog}
            onChange={(e) => setChangelog(e.target.value)}
            placeholder="Что нового..."
          />
        </label>

        <div className="flex items-center justify-between">
          <h4 className="text-sm font-medium">Артефакты</h4>
          <div>
            <input
              ref={fileInputRef}
              type="file"
              multiple
              className="hidden"
              onChange={(e) => addFiles(e.target.files)}
            />
            <Button size="sm" variant="outline" onClick={() => fileInputRef.current?.click()}>
              <Plus className="h-4 w-4 mr-1" /> Добавить файлы
            </Button>
          </div>
        </div>

        {artifacts.length === 0 && (
          <div className="text-sm text-muted-foreground text-center py-6 border border-dashed border-border rounded-md">
            Артефакты не добавлены. Можно создать релиз без файлов.
          </div>
        )}

        {artifacts.map((a, i) => (
          <div key={i} className="rounded-md border border-border p-3 flex flex-col gap-2 text-sm">
            <div className="flex items-center gap-2">
              <FileArchive className="h-4 w-4 text-muted-foreground" />
              <span className="font-medium truncate flex-1" title={a.file.name}>{a.file.name}</span>
              <span className="text-xs text-muted-foreground">{formatBytes(a.file.size)}</span>
              {a.uploadHandle && <Badge className="bg-emerald-500/10 text-emerald-600 border-emerald-400/30">загружен</Badge>}
              <Button size="sm" variant="ghost" onClick={() => removeArtifact(i)} disabled={a.uploading}>
                <XCircle className="h-4 w-4" />
              </Button>
            </div>
            <div className="grid grid-cols-2 gap-2">
              <Input value={a.label} onChange={(e) => {
                const v = e.target.value;
                setArtifacts(prev => prev.map((x, j) => j === i ? { ...x, label: v } : x));
              }} placeholder="Label (например Windows installer)" />
              <Input value={a.platform} onChange={(e) => {
                const v = e.target.value;
                setArtifacts(prev => prev.map((x, j) => j === i ? { ...x, platform: v } : x));
              }} placeholder="Platform (windows / linux / macos)" />
            </div>
            {a.uploading && (
              <div className="flex items-center gap-2">
                <div className="flex-1 h-2 bg-muted rounded overflow-hidden">
                  <div className="h-full bg-accent transition-all" style={{ width: `${a.progress ?? 0}%` }} />
                </div>
                <span className="text-xs text-muted-foreground">{a.progress ?? 0}%</span>
              </div>
            )}
            {a.error && <div className="text-xs text-red-500">{a.error}</div>}
            {a.downloadUrl && (
              <div className="text-xs text-muted-foreground truncate" title={a.downloadUrl}>
                <Download className="h-3 w-3 inline mr-1" />
                <code>{a.downloadUrl}</code>
              </div>
            )}
            {!a.uploadHandle && (
              <Button size="sm" variant="outline" onClick={() => uploadArtifact(i)} disabled={a.uploading || !version}>
                {a.uploading ? <Loader2 className="h-4 w-4 mr-1 animate-spin" /> : <Upload className="h-4 w-4 mr-1" />}
                Загрузить
              </Button>
            )}
          </div>
        ))}
      </div>

      <DialogFooter>
        <Button variant="outline" onClick={onClose} disabled={submitting}>Отмена</Button>
        <Button onClick={submit} disabled={submitting || !version}>
          {submitting ? <Loader2 className="h-4 w-4 mr-1 animate-spin" /> : <Package2 className="h-4 w-4 mr-1" />}
          Создать релиз
        </Button>
      </DialogFooter>
    </Dialog>
  );
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
  return `${(bytes / 1024 / 1024 / 1024).toFixed(2)} GB`;
}
