import { useState } from 'react';
import { Waypoints, RefreshCw, Copy } from 'lucide-react';
import { PageHeader } from '@/components/layout/PageHeader';
import { DashboardGrid } from '@/components/dashboard/DashboardGrid';
import { StatCard } from '@/components/dashboard/StatCard';
import { Button } from '@/components/ui/button';
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/card';
import { Table, TableHeader, TableBody, TableRow, TableHead, TableCell } from '@/components/ui/table';
import { Skeleton } from '@/components/ui/skeleton';
import { EmptyState } from '@/components/feedback/EmptyState';
import { StatusBadge } from '@/components/status/StatusBadge';
import { CopyButton } from '@/components/shared/CopyButton';
import { useTunnelStatus, useProxies } from '@/api/queries/tunnels';

export function TunnelsPage() {
  const { data: status, isLoading: statusLoading } = useTunnelStatus();
  const { data: proxies, isLoading: proxiesLoading } = useProxies();
  const [showConfig, setShowConfig] = useState(false);

  const isLoading = statusLoading || proxiesLoading;
  const connected = status?.status === 'running' || status?.status === 'connected';
  const proxyCount = proxies?.length ?? 0;

  const clientConfig = `# frpc.toml -- Клиентский конфиг
serverAddr = "your-server.borisovai.tech"
serverPort = 17420

[[proxies]]
name = "my-web"
type = "http"
localPort = 3000
customDomains = ["my-web.tunnel.borisovai.tech"]`;

  return (
    <>
      <PageHeader
        title="Туннели"
        description="frp -- проброс локальных сервисов через сервер"
        actions={
          <Button variant="outline" size="sm" onClick={() => setShowConfig(!showConfig)}>
            {showConfig ? 'Скрыть конфиг' : 'Клиентский конфиг'}
          </Button>
        }
      />

      <DashboardGrid>
        <StatCard label="Статус frps" value={connected ? 'Online' : 'Offline'} icon={Waypoints} variant={connected ? 'success' : 'destructive'} />
        <StatCard label="Активных прокси" value={proxyCount} icon={Waypoints} />
      </DashboardGrid>

      {showConfig && (
        <Card className="mb-6">
          <CardHeader className="pb-2">
            <div className="flex items-center justify-between">
              <CardTitle className="text-sm">Конфиг клиента (frpc.toml)</CardTitle>
              <CopyButton text={clientConfig} />
            </div>
          </CardHeader>
          <CardContent>
            <pre className="rounded-lg bg-muted p-4 text-xs font-mono overflow-x-auto whitespace-pre">
              {clientConfig}
            </pre>
          </CardContent>
        </Card>
      )}

      {isLoading ? (
        <div className="space-y-3">
          {Array.from({ length: 3 }).map((_, i) => <Skeleton key={i} className="h-12 w-full" />)}
        </div>
      ) : !proxies?.length ? (
        <EmptyState
          icon={Waypoints}
          title="Нет активных прокси"
          description="Подключите frp-клиент для создания туннелей"
        />
      ) : (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Имя</TableHead>
              <TableHead>Тип</TableHead>
              <TableHead>Статус</TableHead>
              <TableHead>Локальный адрес</TableHead>
              <TableHead>Удалённый адрес</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {proxies.map((p: any) => (
              <TableRow key={p.name}>
                <TableCell className="font-medium">{p.name}</TableCell>
                <TableCell className="font-mono text-sm">{p.type ?? 'http'}</TableCell>
                <TableCell>
                  <StatusBadge status={p.status === 'online' ? 'running' : 'stopped'} />
                </TableCell>
                <TableCell className="font-mono text-sm">{p.localAddr ?? '---'}</TableCell>
                <TableCell className="font-mono text-sm">{p.remoteAddr ?? p.customDomains?.[0] ?? '---'}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}
    </>
  );
}
