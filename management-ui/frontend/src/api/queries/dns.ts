import { useQuery } from '@tanstack/react-query';
import { api } from '../client';

interface DnsRecord {
  id: string;
  subdomain: string;
  domain: string;
  type: string;
  ip: string;
}

export function useDnsRecords() {
  return useQuery({
    queryKey: ['dns', 'records'],
    queryFn: () => api.get<{ records: DnsRecord[] }>('/api/dns/records').then(r => r.records ?? []),
    staleTime: 60_000,
  });
}
