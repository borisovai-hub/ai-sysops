import type {
  PublishPayload, PublishStep, PublishRun,
  ReleasePayload, ReleaseInfo,
} from '@management-ui/shared';

export type ToolResult = {
  status: 'ok' | 'skipped' | 'error';
  detail?: string;
  error?: string;
  before?: Record<string, unknown>;
  after?: Record<string, unknown>;
  requiresApproval?: boolean;
};

export type ToolContext = {
  payload: PublishPayload;
  runId: string;
  dryRun: boolean;
  // Аккумулятор, в котором tools могут делиться результатами
  // (например, traefik knows which domain was created by dns).
  sharedState: Record<string, unknown>;
};

export interface PublishTool {
  kind: PublishStep['kind'];
  execute(ctx: ToolContext): Promise<ToolResult>;
  rollback?(stepState: { before?: Record<string, unknown>; after?: Record<string, unknown> }, ctx: ToolContext): Promise<ToolResult>;
}

export { PublishPayload, PublishStep, PublishRun, ReleasePayload, ReleaseInfo };
