import { readFileSync, existsSync } from 'node:fs';
import { AppError } from '@management-ui/shared';
import { listServers } from './servers.service.js';

const FRPS_CONFIG = process.env.FRPS_CONFIG || '/etc/frp/frps.toml';
const PORT_RANGE_DEFAULT: [number, number] = [17500, 17599];

export interface FrpsConfig {
  serverAddr: string;        // public IP primary (где работает frps)
  controlPort: number;       // bindPort, default 17420
  authToken: string;
  allowPortsRanges: Array<[number, number]>;
}

function parseToml(content: string): FrpsConfig {
  const lines = content.split('\n');
  let bindPort = 17420;
  let authToken = '';
  const ranges: Array<[number, number]> = [];
  let inAllowPorts = false;

  for (const raw of lines) {
    const line = raw.trim();
    if (line.startsWith('bindPort')) {
      const m = line.match(/=\s*(\d+)/);
      if (m) bindPort = parseInt(m[1], 10);
    } else if (line.startsWith('auth.token')) {
      const m = line.match(/=\s*"([^"]+)"/);
      if (m) authToken = m[1];
    } else if (line.startsWith('allowPorts')) {
      inAllowPorts = line.includes('[');
    } else if (inAllowPorts) {
      const m = line.match(/start\s*=\s*(\d+).*?end\s*=\s*(\d+)/);
      if (m) ranges.push([parseInt(m[1], 10), parseInt(m[2], 10)]);
      if (line.includes(']')) inAllowPorts = false;
    }
  }

  if (ranges.length === 0) ranges.push(PORT_RANGE_DEFAULT);
  return {
    serverAddr: process.env.PRIMARY_PUBLIC_IP || '144.91.108.139',
    controlPort: bindPort,
    authToken,
    allowPortsRanges: ranges,
  };
}

export function isFrpsAvailable(): boolean {
  return existsSync(FRPS_CONFIG);
}

export function loadFrpsConfig(): FrpsConfig {
  if (!existsSync(FRPS_CONFIG)) {
    throw new AppError(`frps config не найден: ${FRPS_CONFIG}`, 500);
  }
  return parseToml(readFileSync(FRPS_CONFIG, 'utf-8'));
}

/**
 * Аллокация следующего свободного порта из allowPorts диапазонов.
 * Пропускает порты, занятые в реестре серверов (frps_remote_port).
 */
export function allocateRemotePort(): number {
  const cfg = loadFrpsConfig();
  const used = new Set<number>(
    listServers()
      .map((s) => s.frps_remote_port)
      .filter((p): p is number => typeof p === 'number'),
  );

  // Резерв для агентов: используем верхнюю часть allowPorts (17522..17599),
  // чтобы не конфликтовать с другими TCP-туннелями пользователя.
  for (const [start, end] of cfg.allowPortsRanges) {
    // node-agent диапазон: 17522..end (17500-17521 резерв под будущие нужды)
    const agentStart = Math.max(start, 17522);
    for (let p = agentStart; p <= end; p++) {
      if (!used.has(p)) return p;
    }
  }
  throw new AppError('Нет свободных портов в allowPorts для нового агента', 500);
}
