import { ShieldCheck, ExternalLink, Server } from 'lucide-react';
import { PageHeader } from '@/components/layout/PageHeader';
import { DashboardGrid } from '@/components/dashboard/DashboardGrid';
import { StatCard } from '@/components/dashboard/StatCard';
import { Button } from '@/components/ui/button';
import { Card, CardHeader, CardTitle, CardContent, CardDescription } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { StatusBadge } from '@/components/status/StatusBadge';
import { useCasdoorStatus } from '@/api/queries/casdoor';

const CASDOOR_URL = 'https://auth.trendominus.ru';

export function CasdoorPage() {
  const { data: status, isLoading } = useCasdoorStatus();

  const isRunning = status?.status === 'running';

  return (
    <>
      <PageHeader
        title="Casdoor"
        description="Identity Provider — единая авторизация (SSO/OIDC)"
        actions={
          <a href={CASDOOR_URL} target="_blank" rel="noopener noreferrer">
            <Button size="sm" variant="outline">
              <ExternalLink className="h-4 w-4" /> Открыть Casdoor
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
            label="Статус Casdoor"
            value={isRunning ? 'Online' : 'Offline'}
            icon={ShieldCheck}
            variant={isRunning ? 'success' : 'destructive'}
          />
          <StatCard
            label="Порт"
            value={String(status?.port ?? 8100)}
            icon={Server}
          />
        </DashboardGrid>
      )}

      <Card>
        <CardHeader>
          <CardTitle>Доступ</CardTitle>
          <CardDescription>Casdoor доступен по следующему адресу</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="space-y-3">
            <div className="flex items-center justify-between rounded-lg border border-border p-3">
              <span className="font-mono text-sm">{CASDOOR_URL}</span>
              <div className="flex items-center gap-2">
                <StatusBadge status={isRunning ? 'running' : 'stopped'} />
                <a href={CASDOOR_URL} target="_blank" rel="noopener noreferrer">
                  <Button variant="ghost" size="sm">
                    <ExternalLink className="h-4 w-4" />
                  </Button>
                </a>
              </div>
            </div>
          </div>
        </CardContent>
      </Card>
    </>
  );
}
