export interface DnsRecord {
  id: string;
  subdomain: string;
  domain: string;
  type: string;
  ip: string;
  createdAt?: string;
}

export interface CreateDnsRecordRequest {
  subdomain: string;
  domain?: string;
  type?: string;
  ip: string;
}

export interface UpdateDnsRecordRequest {
  subdomain?: string;
  domain?: string;
  type?: string;
  ip?: string;
}
