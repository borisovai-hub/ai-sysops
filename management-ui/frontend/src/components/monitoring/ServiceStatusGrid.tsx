import type { HealthCheckRow } from '@management-ui/shared';
import { Card, CardContent } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { ServiceStatusCard } from '@/components/monitoring/ServiceStatusCard';

interface ServiceStatusGridProps {
  services: Record<string, HealthCheckRow>;
  onCheckService?: (name: string) => void;
  loading?: boolean;
}

function SkeletonCard() {
  return (
    <Card>
      <CardContent className="p-4 space-y-3">
        <div className="flex items-center justify-between">
          <Skeleton className="h-5 w-28" />
          <Skeleton className="h-5 w-14 rounded-md" />
        </div>
        <div className="flex items-center justify-between">
          <Skeleton className="h-4 w-16" />
          <Skeleton className="h-4 w-24" />
        </div>
      </CardContent>
    </Card>
  );
}

export function ServiceStatusGrid({ services, onCheckService, loading }: ServiceStatusGridProps) {
  if (loading) {
    return (
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
        {Array.from({ length: 6 }, (_, i) => (
          <SkeletonCard key={i} />
        ))}
      </div>
    );
  }

  const entries = Object.entries(services);
  if (entries.length === 0) return null;

  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
      {entries.map(([name, check]) => (
        <ServiceStatusCard
          key={name}
          name={name}
          check={check}
          onCheck={onCheckService ? () => onCheckService(name) : undefined}
        />
      ))}
    </div>
  );
}
