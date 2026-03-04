import { loadAppConfig, loadInstallConfig, getBaseDomains } from '../config/env.js';
import { loadDnsConfig } from '../lib/dns-api.js';

/**
 * Get publish configuration (for projects page).
 */
export function getPublishConfig(): Record<string, unknown> {
  const domains = getBaseDomains();
  const config = loadAppConfig();
  const dnsConfig = loadDnsConfig();
  return {
    baseDomain: domains[0] || dnsConfig.domain || '',
    baseDomains: domains.length > 0 ? domains : (dnsConfig.domain ? [dnsConfig.domain] : []),
    runnerTag: config.runner_tag || 'deploy-production',
    gitlabConfigured: !!(config.gitlab_url && config.gitlab_token),
    strapiConfigured: !!(config.strapi_url && config.strapi_token),
  };
}

/**
 * Get the Management UI URL (for CI variables).
 */
export function getManagementUiUrl(): string {
  const domains = getBaseDomains();
  if (domains.length > 0) return `https://admin.${domains[0]}`;
  return 'http://127.0.0.1:3000';
}

/**
 * Get the first bearer token from auth_tokens in DB (for CI variables).
 * In the new system, tokens are stored hashed, so we can't return raw tokens.
 * This will need a different approach for CI variable setup.
 */
export function getManagementUiToken(): string {
  // In the new architecture, tokens are stored as hashes.
  // CI variables should be set manually or through a dedicated endpoint.
  // For backward compatibility, we return empty string.
  return '';
}
