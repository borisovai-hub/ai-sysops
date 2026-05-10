import { execFileSync, execSync } from 'node:child_process';
import { existsSync, readFileSync as fsReadFileSync } from 'node:fs';
import { AppError } from '@management-ui/shared';

// step-ca CLI обёртка для primary-сервера. Все вызовы локальные:
// step-ca слушает на 127.0.0.1:9000, провайдер-пароль в /etc/step-ca/secrets.

const STEP_BIN = '/usr/local/bin/step';
const CA_URL = process.env.STEP_CA_URL || 'https://127.0.0.1:9000';
const ROOT_CA = process.env.STEP_CA_ROOT || '/etc/step-ca/certs/root_ca.crt';
const PROV_PASS = process.env.STEP_CA_PROV_PASS || '/etc/step-ca/secrets/provisioner-password';
const PROVISIONER_BOOTSTRAP = 'admin-bootstrap';

export function isStepCaAvailable(): boolean {
  return existsSync(STEP_BIN) && existsSync(ROOT_CA) && existsSync(PROV_PASS);
}

export function getRootFingerprint(): string {
  if (!existsSync(STEP_BIN) || !existsSync(ROOT_CA)) {
    throw new AppError('step-ca не установлен на этом сервере', 500);
  }
  const out = execFileSync(STEP_BIN, ['certificate', 'fingerprint', ROOT_CA], { encoding: 'utf-8' });
  return out.trim();
}

const INTERMEDIATE_CA = process.env.STEP_CA_INTERMEDIATE || '/etc/step-ca/certs/intermediate_ca.crt';

/**
 * Возвращает PEM-содержимое intermediate-сертификата для bundle-формирования
 * на secondary-серверах (агент должен отдавать leaf + intermediate клиентам).
 */
export function getIntermediatePem(): string {
  if (!existsSync(INTERMEDIATE_CA)) {
    throw new AppError('intermediate_ca.crt недоступен', 500);
  }
  return fsReadFileSync(INTERMEDIATE_CA, 'utf-8');
}

export function getCaUrlExternal(): string {
  return process.env.STEP_CA_URL_EXTERNAL || 'https://ca.tunnel.borisovai.ru';
}

/**
 * Выдаёт одноразовый JWK bootstrap-токен для нового агента.
 * SAN — то имя, под которым агент получит свой cert.
 */
export function issueBootstrapToken(san: string, ttlMinutes = 60): string {
  if (!isStepCaAvailable()) {
    throw new AppError('step-ca недоступен (нет step CLI или provisioner-password)', 500);
  }
  if (!/^[a-zA-Z0-9._@-]+$/.test(san)) {
    throw new AppError('Невалидный SAN', 400);
  }

  const out = execFileSync(
    STEP_BIN,
    [
      'ca', 'token',
      san,
      '--provisioner', PROVISIONER_BOOTSTRAP,
      '--provisioner-password-file', PROV_PASS,
      '--ca-url', CA_URL,
      '--root', ROOT_CA,
      '--not-after', `${ttlMinutes}m`,
    ],
    { encoding: 'utf-8' },
  );
  // step ca token пишет провайдер в stderr и токен в stdout — берём последнюю не-пустую строку
  return out.trim().split('\n').filter(Boolean).pop() || '';
}

/**
 * Ревокация cert'а по serial (после удаления сервера из реестра).
 */
export function revokeCertBySerial(serial: string, reason = 'unspecified'): void {
  if (!isStepCaAvailable()) {
    throw new AppError('step-ca недоступен', 500);
  }
  if (!/^[0-9a-fA-F]+$/.test(serial)) {
    throw new AppError('Невалидный serial', 400);
  }
  execSync(
    `${STEP_BIN} ca revoke ${serial} --ca-url ${CA_URL} --root ${ROOT_CA} --reason "${reason.replace(/"/g, '')}"`,
    { stdio: 'pipe' },
  );
}

/**
 * Готовая команда для запуска install-node-agent.sh на новом сервере.
 */
export function buildBootstrapCommand(serverName: string, agentSan: string, bootstrapToken: string, caUrlExternal: string, fingerprint: string): string {
  return [
    `# На новом сервере (${serverName}):`,
    `# 1. Сохраните intermediate_pem из ответа API в файл:`,
    `cat > /tmp/intermediate.crt << 'PEM_EOF'`,
    `# (вставьте сюда intermediate_pem)`,
    `PEM_EOF`,
    ``,
    `curl -fsSL https://github.com/borisovai-hub/ai-sysops/raw/main/scripts/single-machine/install-node-agent.sh -o /tmp/install-node-agent.sh`,
    `chmod +x /tmp/install-node-agent.sh`,
    `STEP_CA_ROOT_FINGERPRINT='${fingerprint}' \\`,
    `STEP_CA_INTERMEDIATE_PEM="$(cat /tmp/intermediate.crt)" \\`,
    `  /tmp/install-node-agent.sh \\`,
    `    --server-name ${serverName} \\`,
    `    --ca-url ${caUrlExternal} \\`,
    `    --bootstrap-token '${bootstrapToken}' \\`,
    `    --listen 0.0.0.0:7180`,
  ].join('\n');
}
