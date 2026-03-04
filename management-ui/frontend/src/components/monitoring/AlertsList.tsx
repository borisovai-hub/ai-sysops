import type { AlertRow } from '@management-ui/shared';
import { AlertTriangle, CheckCheck, CheckCircle, Info, ShieldAlert } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import {
  Table,
  TableHeader,
  TableBody,
  TableRow,
  TableHead,
  TableCell,
} from '@/components/ui/table';
import { RelativeTime } from '@/components/shared/RelativeTime';

interface AlertsListProps {
  alerts: AlertRow[];
  onAck?: (id: number) => void;
  onResolve?: (id: number) => void;
  loading?: boolean;
}

const severityConfig: Record<string, {
  icon: typeof Info;
  variant: 'default' | 'warning' | 'destructive';
  label: string;
}> = {
  info: { icon: Info, variant: 'default', label: 'Info' },
  warning: { icon: AlertTriangle, variant: 'warning', label: 'Warning' },
  critical: { icon: ShieldAlert, variant: 'destructive', label: 'Critical' },
};

function SkeletonRow() {
  return (
    <TableRow>
      <TableCell><Skeleton className="h-5 w-20 rounded-md" /></TableCell>
      <TableCell><Skeleton className="h-4 w-32" /></TableCell>
      <TableCell><Skeleton className="h-4 w-48" /></TableCell>
      <TableCell><Skeleton className="h-4 w-20" /></TableCell>
      <TableCell><Skeleton className="h-4 w-24" /></TableCell>
      <TableCell><Skeleton className="h-8 w-20" /></TableCell>
    </TableRow>
  );
}

export function AlertsList({ alerts, onAck, onResolve, loading }: AlertsListProps) {
  if (loading) {
    return (
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Severity</TableHead>
            <TableHead>Title</TableHead>
            <TableHead>Message</TableHead>
            <TableHead>Source</TableHead>
            <TableHead>Time</TableHead>
            <TableHead>Actions</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {Array.from({ length: 3 }, (_, i) => (
            <SkeletonRow key={i} />
          ))}
        </TableBody>
      </Table>
    );
  }

  if (alerts.length === 0) {
    return (
      <p className="text-sm text-muted-foreground py-6 text-center">
        Нет активных алертов
      </p>
    );
  }

  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>Severity</TableHead>
          <TableHead>Title</TableHead>
          <TableHead>Message</TableHead>
          <TableHead>Source</TableHead>
          <TableHead>Time</TableHead>
          <TableHead>Actions</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {alerts.map((alert) => {
          const cfg = severityConfig[alert.severity] ?? severityConfig.info;
          const SeverityIcon = cfg.icon;

          return (
            <TableRow key={alert.id}>
              <TableCell>
                <Badge variant={cfg.variant} className="gap-1">
                  <SeverityIcon className="h-3 w-3" />
                  {cfg.label}
                </Badge>
              </TableCell>
              <TableCell className="font-medium">{alert.title}</TableCell>
              <TableCell className="max-w-xs truncate">{alert.message}</TableCell>
              <TableCell className="text-muted-foreground">{alert.source}</TableCell>
              <TableCell>
                <RelativeTime date={alert.createdAt} className="text-muted-foreground text-sm" />
              </TableCell>
              <TableCell>
                <div className="flex items-center gap-1">
                  {onAck && (
                    <Button
                      variant="ghost"
                      size="icon"
                      title="Acknowledge"
                      disabled={alert.status !== 'active'}
                      onClick={() => onAck(alert.id)}
                    >
                      <CheckCheck className="h-4 w-4" />
                    </Button>
                  )}
                  {onResolve && (
                    <Button
                      variant="ghost"
                      size="icon"
                      title="Resolve"
                      disabled={alert.status === 'resolved'}
                      onClick={() => onResolve(alert.id)}
                    >
                      <CheckCircle className="h-4 w-4" />
                    </Button>
                  )}
                </div>
              </TableCell>
            </TableRow>
          );
        })}
      </TableBody>
    </Table>
  );
}
