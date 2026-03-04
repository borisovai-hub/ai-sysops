import { useState } from 'react';
import { toast } from 'sonner';
import { FileText, Eye, EyeOff } from 'lucide-react';
import { PageHeader } from '@/components/layout/PageHeader';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Table, TableHeader, TableBody, TableRow, TableHead, TableCell } from '@/components/ui/table';
import { Skeleton } from '@/components/ui/skeleton';
import { EmptyState } from '@/components/feedback/EmptyState';
import { ConfirmDialog } from '@/components/feedback/ConfirmDialog';
import { RelativeTime } from '@/components/shared/RelativeTime';
import { useDrafts } from '@/api/queries/content';
import { usePublishContent, useUnpublishContent } from '@/api/mutations/content';

export function ContentPage() {
  const { data: drafts, isLoading } = useDrafts();
  const publishContent = usePublishContent();
  const unpublishContent = useUnpublishContent();

  const [confirmAction, setConfirmAction] = useState<{ id: string; action: 'publish' | 'unpublish'; title: string } | null>(null);

  const handleConfirm = () => {
    if (!confirmAction) return;
    const mutation = confirmAction.action === 'publish' ? publishContent : unpublishContent;
    const label = confirmAction.action === 'publish' ? 'Опубликовано' : 'Снято с публикации';
    mutation.mutate(confirmAction.id, {
      onSuccess: () => {
        setConfirmAction(null);
        toast.success(label);
      },
    });
  };

  return (
    <>
      <PageHeader
        title="Контент"
        description="Черновики и публикации Strapi"
      />

      {isLoading ? (
        <div className="space-y-3">
          {Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} className="h-12 w-full" />)}
        </div>
      ) : !drafts?.length ? (
        <EmptyState
          icon={FileText}
          title="Нет черновиков"
          description="Черновики из Strapi появятся здесь"
        />
      ) : (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Название</TableHead>
              <TableHead>Slug</TableHead>
              <TableHead>Тип</TableHead>
              <TableHead>Статус</TableHead>
              <TableHead>Обновлено</TableHead>
              <TableHead className="w-24">Действия</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {drafts.map((d: any) => (
              <TableRow key={d.id}>
                <TableCell className="font-medium">{d.title}</TableCell>
                <TableCell className="font-mono text-sm">{d.slug}</TableCell>
                <TableCell>{d.type ?? d.contentType ?? '---'}</TableCell>
                <TableCell>
                  {d.publishedAt ? (
                    <Badge variant="success">Опубликовано</Badge>
                  ) : (
                    <Badge variant="secondary">Черновик</Badge>
                  )}
                </TableCell>
                <TableCell>
                  {d.updatedAt ? <RelativeTime date={d.updatedAt} /> : '---'}
                </TableCell>
                <TableCell>
                  {d.publishedAt ? (
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => setConfirmAction({ id: d.id, action: 'unpublish', title: d.title })}
                    >
                      <EyeOff className="h-4 w-4 mr-1" /> Снять
                    </Button>
                  ) : (
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => setConfirmAction({ id: d.id, action: 'publish', title: d.title })}
                    >
                      <Eye className="h-4 w-4 mr-1" /> Опубл.
                    </Button>
                  )}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}

      <ConfirmDialog
        open={!!confirmAction}
        onOpenChange={(v) => !v && setConfirmAction(null)}
        title={confirmAction?.action === 'publish' ? 'Опубликовать' : 'Снять с публикации'}
        description={
          confirmAction?.action === 'publish'
            ? `Опубликовать "${confirmAction.title}"?`
            : `Снять "${confirmAction?.title}" с публикации?`
        }
        confirmLabel={confirmAction?.action === 'publish' ? 'Опубликовать' : 'Снять'}
        onConfirm={handleConfirm}
        loading={publishContent.isPending || unpublishContent.isPending}
        destructive={confirmAction?.action === 'unpublish'}
      />
    </>
  );
}
