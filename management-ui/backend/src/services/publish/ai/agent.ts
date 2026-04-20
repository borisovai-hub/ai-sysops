import Anthropic from '@anthropic-ai/sdk';
import { randomUUID } from 'node:crypto';
import { logger } from '../../../lib/logger.js';
import { getSystemPrompt, getCacheInfo } from './prompt.js';
import {
  listToolDefs, getTool, effectiveTier, type PublishApprovals,
} from './tools-registry.js';
import type { AgentToolDef } from '@management-ui/shared';

// --- SSE event contract ---
export type SseEvent =
  | { event: 'session'; data: { sessionId: string; model: string; cacheHit: boolean; tools: string[] } }
  | { event: 'thinking'; data: { text: string } }
  | { event: 'text_delta'; data: { text: string } }
  | { event: 'question'; data: { text: string } }
  | { event: 'plan'; data: Record<string, unknown> }
  | { event: 'tool_call'; data: { toolName: string; toolUseId: string; args: Record<string, unknown>; tier: string } }
  | { event: 'tool_result'; data: { toolUseId: string; isError: boolean; result: unknown } }
  | { event: 'approval_required'; data: { approvalId: string; toolName: string; args: Record<string, unknown>; detail: string } }
  | { event: 'progress'; data: { text: string } }
  | { event: 'done'; data: { summary: string } }
  | { event: 'error'; data: { code: string; message: string } };

export type Emit = (e: SseEvent) => void;

// --- Approval queue ---
interface ApprovalRequest {
  id: string;
  sessionId: string;
  toolName: string;
  args: Record<string, unknown>;
  resolve: (approved: boolean) => void;
  createdAt: number;
}
const APPROVAL_QUEUE = new Map<string, ApprovalRequest>();
const APPROVAL_TTL_MS = 10 * 60 * 1000;

export function resolveApproval(approvalId: string, decision: 'approve' | 'reject'): boolean {
  const req = APPROVAL_QUEUE.get(approvalId);
  if (!req) return false;
  req.resolve(decision === 'approve');
  APPROVAL_QUEUE.delete(approvalId);
  return true;
}

function waitForApproval(sessionId: string, toolName: string, args: Record<string, unknown>, emit: Emit): Promise<boolean> {
  return new Promise((resolve) => {
    const id = `apr_${randomUUID().slice(0, 12)}`;
    const req: ApprovalRequest = { id, sessionId, toolName, args, resolve, createdAt: Date.now() };
    APPROVAL_QUEUE.set(id, req);
    emit({
      event: 'approval_required',
      data: { approvalId: id, toolName, args, detail: `Tool ${toolName} требует подтверждения` },
    });
    // Auto-timeout
    setTimeout(() => {
      if (APPROVAL_QUEUE.has(id)) {
        APPROVAL_QUEUE.delete(id);
        resolve(false);
      }
    }, APPROVAL_TTL_MS);
  });
}

// --- Question queue (user answer to clarifying question) ---
interface QuestionRequest {
  sessionId: string;
  resolve: (answer: string) => void;
  createdAt: number;
}
const QUESTION_QUEUE = new Map<string, QuestionRequest>();

export function answerQuestion(sessionId: string, answer: string): boolean {
  const req = QUESTION_QUEUE.get(sessionId);
  if (!req) return false;
  req.resolve(answer);
  QUESTION_QUEUE.delete(sessionId);
  return true;
}

// --- LLM client ---
function getClient(): Anthropic {
  const key = process.env.ANTHROPIC_API_KEY;
  if (!key) throw new Error('ANTHROPIC_API_KEY not set');
  return new Anthropic({ apiKey: key });
}

function toAnthropicTools(defs: AgentToolDef[]): Anthropic.Tool[] {
  return defs.map(t => ({
    name: t.name,
    description: t.description,
    input_schema: {
      type: 'object' as const,
      properties: Object.fromEntries(
        t.parameters.map(p => [p.name, {
          type: p.type,
          description: p.description,
          ...(p.enum ? { enum: p.enum } : {}),
        }]),
      ),
      required: t.parameters.filter(p => p.required).map(p => p.name),
    },
  }));
}

// --- Main loop ---

export interface AiRunInput {
  sessionId: string;
  prompt: string;
  approvals: PublishApprovals;
  context?: { gitlabProjectPath?: string; preferredType?: string };
}

const DEFAULT_MODEL = process.env.PUBLISH_AI_MODEL || 'claude-sonnet-4-5';
const MAX_ITERATIONS = 12;

export async function runAiPublisher(input: AiRunInput, emit: Emit): Promise<void> {
  const tools = listToolDefs();
  const cacheInfo = getCacheInfo();
  emit({
    event: 'session',
    data: { sessionId: input.sessionId, model: DEFAULT_MODEL, cacheHit: cacheInfo.loaded, tools: tools.map(t => t.name) },
  });

  const system = getSystemPrompt();
  const client = getClient();
  const anthropicTools = toAnthropicTools(tools);

  const contextStr = input.context
    ? `\n\nКонтекст пользователя: ${JSON.stringify(input.context)}`
    : '';
  const messages: Anthropic.MessageParam[] = [
    { role: 'user', content: input.prompt + contextStr },
  ];

  for (let iter = 0; iter < MAX_ITERATIONS; iter++) {
    let response: Anthropic.Message;
    try {
      response = await client.messages.create({
        model: DEFAULT_MODEL,
        max_tokens: 4096,
        system: [{ type: 'text', text: system, cache_control: { type: 'ephemeral' } }],
        tools: anthropicTools,
        messages,
      });
    } catch (err) {
      const msg = (err as Error).message;
      emit({ event: 'error', data: { code: 'LLM_ERROR', message: msg } });
      logger.error('publish-ai LLM error:', msg);
      return;
    }

    // Накопить assistant сообщение
    const assistantContent: Anthropic.ContentBlockParam[] = [];
    const toolUses: Array<{ id: string; name: string; input: Record<string, unknown> }> = [];
    for (const block of response.content) {
      if (block.type === 'text') {
        if (block.text.trim()) {
          emit({ event: 'text_delta', data: { text: block.text } });
        }
        assistantContent.push({ type: 'text', text: block.text });
      } else if (block.type === 'tool_use') {
        toolUses.push({ id: block.id, name: block.name, input: block.input as Record<string, unknown> });
        assistantContent.push({
          type: 'tool_use', id: block.id, name: block.name, input: block.input,
        });
      }
    }
    messages.push({ role: 'assistant', content: assistantContent });

    // Если нет tool_use — LLM завершила
    if (response.stop_reason === 'end_turn' || toolUses.length === 0) {
      const summary = response.content
        .filter((c): c is Anthropic.TextBlock => c.type === 'text')
        .map(c => c.text).join('\n').trim();
      emit({ event: 'done', data: { summary } });
      return;
    }

    // Обработать tool_use → tool_result
    const toolResults: Anthropic.ToolResultBlockParam[] = [];
    for (const tu of toolUses) {
      const tier = effectiveTier(tu.name, input.approvals);
      emit({
        event: 'tool_call',
        data: { toolName: tu.name, toolUseId: tu.id, args: tu.input, tier },
      });

      // Approval gate
      if (tier === 'approve') {
        const approved = await waitForApproval(input.sessionId, tu.name, tu.input, emit);
        if (!approved) {
          const denyMsg = 'Пользователь отклонил вызов инструмента.';
          toolResults.push({
            type: 'tool_result', tool_use_id: tu.id, is_error: true,
            content: denyMsg,
          });
          emit({ event: 'tool_result', data: { toolUseId: tu.id, isError: true, result: denyMsg } });
          continue;
        }
      }

      // Выполнить tool
      const spec = getTool(tu.name);
      if (!spec) {
        const err = `Unknown tool: ${tu.name}`;
        toolResults.push({ type: 'tool_result', tool_use_id: tu.id, is_error: true, content: err });
        emit({ event: 'tool_result', data: { toolUseId: tu.id, isError: true, result: err } });
        continue;
      }
      try {
        const result = await spec.execute(tu.input, { runId: undefined });
        // Для publish_dry_run — также эмитим событие plan
        if (tu.name === 'publish_dry_run') {
          emit({ event: 'plan', data: result });
        }
        const resStr = JSON.stringify(result);
        toolResults.push({
          type: 'tool_result', tool_use_id: tu.id,
          content: resStr.length > 8000 ? resStr.slice(0, 8000) + '...[truncated]' : resStr,
        });
        emit({ event: 'tool_result', data: { toolUseId: tu.id, isError: false, result } });
      } catch (err) {
        const msg = (err as Error).message;
        toolResults.push({
          type: 'tool_result', tool_use_id: tu.id, is_error: true, content: msg,
        });
        emit({ event: 'tool_result', data: { toolUseId: tu.id, isError: true, result: msg } });
      }
    }
    messages.push({ role: 'user', content: toolResults });
  }

  emit({ event: 'error', data: { code: 'MAX_ITERATIONS', message: `Достигнут лимит ${MAX_ITERATIONS} итераций` } });
}
