import { execCommandSafe } from '../exec.js';
import { listTraefikServices, createTraefikConfig, deleteTraefikConfig } from '../traefik.js';
import { dnsApiProxy, createDnsRecordsForAllDomains, deleteDnsRecord } from '../dns-api.js';
import { getGitStatus, getGitDiff, getGitLog, commitChanges, pushChanges } from '../git.js';
import { readFileSync, writeFileSync, readdirSync, statSync, mkdirSync, rmSync, existsSync } from 'node:fs';
import { join, resolve } from 'node:path';
import type { ToolResult } from './tool-definitions.js';
import { monitoringService, loadMonitoringConfig } from '../../services/monitoring.service.js';
import * as alertService from '../../services/alert.service.js';
import * as securityService from '../../services/security.service.js';

/**
 * Выполнить инструмент и вернуть результат
 */
export async function executeTool(name: string, args: Record<string, unknown>): Promise<ToolResult> {
  try {
    switch (name) {
      case 'shell_exec': {
        const cmd = String(args.command ?? '');
        if (!cmd) return { output: 'Пустая команда', success: false };
        const res = execCommandSafe(cmd);
        return { output: res.stdout || res.error || '(нет вывода)', success: res.success };
      }

      case 'file_read': {
        const path = String(args.path ?? '');
        if (!existsSync(path)) return { output: `Файл не найден: ${path}`, success: false };
        const content = readFileSync(path, 'utf-8');
        const maxLines = Number(args.maxLines) || 200;
        const lines = content.split('\n');
        const truncated = lines.length > maxLines;
        const result = lines.slice(0, maxLines).join('\n');
        return {
          output: truncated ? `${result}\n\n... (обрезано, всего ${lines.length} строк)` : result,
          success: true,
        };
      }

      case 'file_write': {
        const path = String(args.path ?? '');
        const content = String(args.content ?? '');
        const dir = resolve(path, '..');
        if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
        writeFileSync(path, content, 'utf-8');
        return { output: `Файл записан: ${path} (${content.length} байт)`, success: true };
      }

      case 'file_list': {
        const path = String(args.path ?? '');
        if (!existsSync(path)) return { output: `Директория не найдена: ${path}`, success: false };
        const entries = readdirSync(path);
        const items = entries.map((e) => {
          try {
            const st = statSync(join(path, e));
            return `${st.isDirectory() ? 'd' : 'f'} ${e} (${st.size}b)`;
          } catch {
            return `? ${e}`;
          }
        });
        return { output: items.join('\n') || '(пусто)', success: true };
      }

      case 'file_delete': {
        const path = String(args.path ?? '');
        if (!existsSync(path)) return { output: `Не найдено: ${path}`, success: false };
        rmSync(path, { recursive: true, force: true });
        return { output: `Удалено: ${path}`, success: true };
      }

      case 'file_mkdir': {
        const path = String(args.path ?? '');
        mkdirSync(path, { recursive: true });
        return { output: `Создано: ${path}`, success: true };
      }

      case 'services_list': {
        const services = listTraefikServices();
        return { output: JSON.stringify(services, null, 2), success: true };
      }

      case 'service_create': {
        const result = createTraefikConfig(
          String(args.name),
          String(args.domain),
          String(args.ip ?? '127.0.0.1'),
          Number(args.port),
          { authelia: Boolean(args.authelia ?? false) },
        );
        return { output: `Сервис создан: ${args.name} — ${result.detail}`, success: result.done };
      }

      case 'service_delete': {
        deleteTraefikConfig(String(args.name));
        return { output: `Сервис удалён: ${args.name}`, success: true };
      }

      case 'dns_list': {
        const records = await dnsApiProxy('GET', '/api/records');
        return { output: JSON.stringify(records, null, 2), success: true };
      }

      case 'dns_create': {
        const ip = args.ip ? String(args.ip) : '62.171.135.139'; // default Contabo IP
        const result = await createDnsRecordsForAllDomains(String(args.subdomain), ip);
        return { output: JSON.stringify(result, null, 2), success: true };
      }

      case 'dns_delete': {
        await deleteDnsRecord(String(args.id));
        return { output: `DNS-запись удалена: ${args.id}`, success: true };
      }

      case 'git_status': {
        const status = await getGitStatus();
        return { output: JSON.stringify(status, null, 2), success: true };
      }

      case 'git_diff': {
        const diff = await getGitDiff(args.staged ? '--cached' : undefined);
        return { output: diff || '(нет изменений)', success: true };
      }

      case 'git_log': {
        const log = await getGitLog(Number(args.count) || 10);
        return { output: JSON.stringify(log, null, 2), success: true };
      }

      case 'git_commit': {
        const files = args.files ? String(args.files).split(',').map((f) => f.trim()) : ['.'];
        const result = await commitChanges(files, String(args.message));
        return { output: JSON.stringify(result), success: true };
      }

      case 'git_push': {
        const result = await pushChanges();
        return { output: JSON.stringify(result), success: true };
      }

      // --- Monitoring tools ---
      case 'monitoring_status': {
        const config = await loadMonitoringConfig();
        if (!config.enabled) return { output: 'Мониторинг отключён', success: true };
        const statuses = await monitoringService.getLatestStatuses();
        return { output: JSON.stringify(statuses, null, 2), success: true };
      }

      case 'monitoring_history': {
        const svcName = String(args.serviceName ?? '');
        if (!svcName) return { output: 'serviceName обязателен', success: false };
        const serverName = String(args.serverName ?? 'contabo-sm-139');
        const hours = Number(args.hours) || 24;
        const history = await monitoringService.getServiceHistory(serverName, svcName, hours);
        return { output: JSON.stringify(history, null, 2), success: true };
      }

      case 'monitoring_uptime': {
        const days = Number(args.days) || 7;
        const stats = await monitoringService.getAllUptimeStats(days);
        return { output: JSON.stringify(stats, null, 2), success: true };
      }

      case 'monitoring_check': {
        const config = await loadMonitoringConfig();
        if (!config.enabled) return { output: 'Мониторинг отключён', success: true };
        const svc = args.serviceName ? String(args.serviceName) : null;
        if (svc) {
          const result = await monitoringService.runSingleCheck(svc);
          return { output: JSON.stringify(result, null, 2), success: true };
        }
        await monitoringService.runAllChecks();
        return { output: 'Проверка всех сервисов запущена', success: true };
      }

      case 'security_analyze': {
        const config = await loadMonitoringConfig();
        if (!config.security.enabled) return { output: 'Security мониторинг отключён', success: true };
        const hours = Number(args.hours) || 6;
        const events = await securityService.analyzeAutheliaLogs(hours);
        return { output: events.length ? JSON.stringify(events, null, 2) : 'Подозрительной активности не обнаружено', success: true };
      }

      case 'security_traffic': {
        const config = await loadMonitoringConfig();
        if (!config.security.enabled) return { output: 'Security мониторинг отключён', success: true };
        const minutes = Number(args.minutes) || 60;
        const events = await securityService.analyzeTraefikTraffic(minutes);
        return { output: events.length ? JSON.stringify(events, null, 2) : 'Подозрительного трафика не обнаружено', success: true };
      }

      case 'security_config_scan': {
        const config = await loadMonitoringConfig();
        if (!config.security.enabled) return { output: 'Security мониторинг отключён', success: true };
        const events = await securityService.scanConfiguration();
        return { output: events.length ? JSON.stringify(events, null, 2) : 'Проблем с конфигурацией не обнаружено', success: true };
      }

      case 'security_events': {
        const events = await securityService.getSecurityEvents({
          severity: args.severity ? String(args.severity) : undefined,
          limit: Number(args.limit) || 50,
        });
        return { output: JSON.stringify(events, null, 2), success: true };
      }

      case 'security_block_ip': {
        const ip = String(args.ip ?? '');
        const reason = String(args.reason ?? '');
        if (!ip) return { output: 'IP обязателен', success: false };
        const cmd = `iptables -A INPUT -s ${ip} -j DROP`;
        const res = execCommandSafe(cmd);
        if (res.success) {
          await alertService.createAlert({
            severity: 'critical',
            category: 'security',
            source: `ip_block:${ip}`,
            title: `IP заблокирован: ${ip}`,
            message: reason || 'Заблокировано агентом',
          });
        }
        return { output: res.success ? `IP ${ip} заблокирован` : `Ошибка: ${res.error}`, success: res.success };
      }

      case 'service_restart': {
        const svc = String(args.serviceName ?? '');
        if (!svc) return { output: 'serviceName обязателен', success: false };
        const res = execCommandSafe(`systemctl restart ${svc}`);
        return { output: res.success ? `Сервис ${svc} перезапущен` : `Ошибка: ${res.error}`, success: res.success };
      }

      case 'alerts_list': {
        const status = args.status ? String(args.status) : 'active';
        const alerts = await alertService.getAlerts({ status });
        return { output: JSON.stringify(alerts, null, 2), success: true };
      }

      case 'alerts_acknowledge': {
        const id = Number(args.alertId);
        if (!id) return { output: 'alertId обязателен', success: false };
        const alert = await alertService.acknowledgeAlert(id, 'agent');
        return { output: alert ? `Алерт #${id} подтверждён` : `Алерт #${id} не найден`, success: !!alert };
      }

      default:
        return { output: `Неизвестный инструмент: ${name}`, success: false };
    }
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    return { output: `Ошибка: ${msg}`, success: false };
  }
}
