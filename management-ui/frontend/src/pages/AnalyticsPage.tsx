import { BarChart3, ExternalLink } from 'lucide-react';
import { PageHeader } from '@/components/layout/PageHeader';
import { DashboardGrid } from '@/components/dashboard/DashboardGrid';
import { StatCard } from '@/components/dashboard/StatCard';
import { Button } from '@/components/ui/button';
import { Card, CardHeader, CardTitle, CardContent, CardDescription } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { StatusBadge } from '@/components/status/StatusBadge';
import { useAnalyticsStatus } from '@/api/queries/analytics';

const UMAMI_URLS = [
  'https://analytics.dev.borisovai.tech',
  'https://analytics.dev.borisovai.ru',
];

export function AnalyticsPage() {
  const { data: status, isLoading } = useAnalyticsStatus();

  const isRunning = status?.status === 'running' || status?.status === 'ok';

  return (
    <>
      <PageHeader
        title="Аналитика"
        description="Umami -- self-hosted веб-аналитика"
        actions={
          <a href={UMAMI_URLS[0]} target="_blank" rel="noopener noreferrer">
            <Button size="sm" variant="outline">
              <ExternalLink className="h-4 w-4" /> Открыть Umami
            </Button>
          </a>
        }
      />

      {isLoading ? (
        <DashboardGrid>
          <Skeleton className="h-24 w-full" />
          <Skeleton className="h-24 w-full" />
        </DashboardGrid>
      ) : (
        <DashboardGrid>
          <StatCard
            label="Статус Umami"
            value={isRunning ? 'Online' : 'Offline'}
            icon={BarChart3}
            variant={isRunning ? 'success' : 'destructive'}
          />
          <StatCard
            label="Порт"
            value="3001"
            icon={BarChart3}
          />
        </DashboardGrid>
      )}

      <Card>
        <CardHeader>
          <CardTitle>Доступ к дашборду</CardTitle>
          <CardDescription>Umami доступен по следующим адресам</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="space-y-3">
            {UMAMI_URLS.map((url) => (
              <div key={url} className="flex items-center justify-between rounded-lg border border-border p-3">
                <span className="font-mono text-sm">{url}</span>
                <div className="flex items-center gap-2">
                  <StatusBadge status={isRunning ? 'running' : 'stopped'} />
                  <a href={url} target="_blank" rel="noopener noreferrer">
                    <Button variant="ghost" size="sm">
                      <ExternalLink className="h-4 w-4" />
                    </Button>
                  </a>
                </div>
              </div>
            ))}
          </div>
        </CardContent>
      </Card>
    </>
  );
}
