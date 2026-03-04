import { randomUUID } from 'node:crypto';
import { eq, desc } from 'drizzle-orm';
import { getDb } from '../db/index.js';
import * as schema from '../db/schema.js';
import { LLMClient, type LLMMessage, type LLMResponse } from '../lib/llm-client.js';
import { AGENT_TOOLS, executeTool, resolveToolTier, type ToolResult } from '../lib/agent/index.js';
import type { AgentEvent, AgentSession, AgentMessage, AgentApproval, ApprovalTier } from '@management-ui/shared';

// --- Approval waiting ---

interface PendingApproval {
  resolve: (approved: boolean) => void;
  request: typeof schema.agentApprovals.$inferInsert;
}

const pendingApprovals = new Map<string, PendingApproval>();

// --- System prompt ---

const SYSTEM_PROMPT = `Ты — AI-агент для управления инфраструктурой сервера.
У тебя есть инструменты для выполнения команд, управления файлами, DNS, Traefik-сервисами и Git.

Правила:
- Отвечай на русском языке
- Перед деструктивными операциями (удаление, перезапись, push) объясни что собираешься делать
- Используй shell_exec с safe=true для чтения (ls, cat, docker ps, systemctl status)
- Используй shell_exec с safe=false для модификаций (rm, docker restart, apt install)
- Если инструмент требует подтверждения — пользователь увидит запрос в UI
- Будь кратким и точным
- При ошибке инструмента — объясни что пошло не так и предложи решение`;

// --- LLM singleton ---

let llmClient: LLMClient | null = null;

function getLLM(): LLMClient {
  if (!llmClient) {
    llmClient = new LLMClient({
      apiKey: process.env.ANTHROPIC_API_KEY,
      model: process.env.AGENT_MODEL || 'claude-sonnet-4-20250514',
      cliModel: process.env.AGENT_CLI_MODEL || 'sonnet',
    });
  }
  return llmClient;
}

// --- Session CRUD ---

export async function createSession(title?: string, model?: string, systemPrompt?: string): Promise<AgentSession> {
  const db = getDb();
  const now = new Date().toISOString();
  const session = {
    id: randomUUID(),
    title: title || 'Новая сессия',
    model: model || process.env.AGENT_MODEL || 'claude-sonnet-4-20250514',
    systemPrompt: systemPrompt ?? null,
    createdAt: now,
    updatedAt: now,
  };
  await db.insert(schema.agentSessions).values(session);
  return { ...session, systemPrompt: session.systemPrompt ?? undefined };
}

export async function listSessions(): Promise<AgentSession[]> {
  const db = getDb();
  const rows = await db.select().from(schema.agentSessions).orderBy(desc(schema.agentSessions.updatedAt));
  return rows.map((r) => ({ ...r, systemPrompt: r.systemPrompt ?? undefined }));
}

export async function getSession(id: string): Promise<AgentSession | null> {
  const db = getDb();
  const rows = await db.select().from(schema.agentSessions).where(eq(schema.agentSessions.id, id));
  if (rows.length === 0) return null;
  const r = rows[0];
  return { ...r, systemPrompt: r.systemPrompt ?? undefined };
}

export async function deleteSession(id: string): Promise<void> {
  const db = getDb();
  await db.delete(schema.agentSessions).where(eq(schema.agentSessions.id, id));
}

export async function getSessionMessages(sessionId: string): Promise<AgentMessage[]> {
  const db = getDb();
  return await db.select().from(schema.agentMessages)
    .where(eq(schema.agentMessages.sessionId, sessionId))
    .orderBy(schema.agentMessages.createdAt) as AgentMessage[];
}

// --- Approval management ---

export async function getPendingApprovals(sessionId?: string): Promise<AgentApproval[]> {
  const db = getDb();
  if (sessionId) {
    return await db.select().from(schema.agentApprovals)
      .where(eq(schema.agentApprovals.sessionId, sessionId)) as AgentApproval[];
  }
  return await db.select().from(schema.agentApprovals) as AgentApproval[];
}

export async function resolveApproval(id: string, approved: boolean, reason?: string): Promise<void> {
  const db = getDb();
  await db.update(schema.agentApprovals)
    .set({
      status: approved ? 'approved' : 'denied',
      reason: reason ?? null,
      resolvedAt: new Date().toISOString(),
    })
    .where(eq(schema.agentApprovals.id, id));

  // Разблокируем ожидающий tool loop
  const pending = pendingApprovals.get(id);
  if (pending) {
    pending.resolve(approved);
    pendingApprovals.delete(id);
  }
}

// --- Main chat loop (SSE generator) ---

export async function* processMessage(
  sessionId: string,
  userMessage: string,
): AsyncGenerator<AgentEvent> {
  const db = getDb();
  const llm = getLLM();

  // Сохраняем user message
  await saveMessage(sessionId, 'user', userMessage);

  // Загружаем историю
  const history = await getSessionMessages(sessionId);
  const session = await getSession(sessionId);
  const systemPrompt = session?.systemPrompt || SYSTEM_PROMPT;

  // Конвертируем историю в формат LLM
  const messages = buildLLMMessages(history);

  // Tool loop (max 10 итераций)
  const MAX_ITERATIONS = 10;
  let iteration = 0;

  while (iteration < MAX_ITERATIONS) {
    iteration++;

    let response: LLMResponse;
    try {
      response = await llm.chat(messages, systemPrompt, AGENT_TOOLS);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      yield { type: 'error', data: { message: msg } };
      await saveMessage(sessionId, 'assistant', `Ошибка LLM: ${msg}`);
      break;
    }

    // Текстовый ответ
    if (response.text) {
      yield { type: 'text_delta', data: { text: response.text } };
    }

    // Нет tool calls → завершаем
    if (response.toolCalls.length === 0) {
      if (response.text) {
        await saveMessage(sessionId, 'assistant', response.text);
      }
      break;
    }

    // Сохраняем ассистентский ответ с tool calls
    if (response.text) {
      await saveMessage(sessionId, 'assistant', response.text);
    }

    // Обрабатываем tool calls
    for (const tc of response.toolCalls) {
      const tier = resolveToolTier(tc.name, tc.input);

      yield {
        type: 'tool_call',
        data: { id: tc.id, name: tc.name, args: tc.input, tier },
      };

      // Сохраняем tool_call
      await saveMessage(sessionId, 'tool_call', JSON.stringify(tc.input), tc.name, tc.id, undefined, tier);

      // Проверяем approval
      let approved = true;
      if (tier === 'approve') {
        approved = await requestApproval(sessionId, tc, tier, (evt) => {
          // Эта функция вызывается для SSE event — но мы в generator, нужен другой подход
        });

        // Отправляем SSE с запросом подтверждения
        const approvalId = [...pendingApprovals.keys()].find((k) => {
          const p = pendingApprovals.get(k);
          return p?.request.toolName === tc.name;
        });

        if (approvalId && !approved) {
          // Ожидаем подтверждения
          yield {
            type: 'approval_required',
            data: { approvalId, toolName: tc.name, args: tc.input, tier },
          };
        }
      }

      let result: ToolResult;
      if (approved) {
        // Выполняем инструмент
        result = await executeTool(tc.name, tc.input);
      } else {
        result = { output: 'Отклонено пользователем', success: false };
      }

      yield {
        type: 'tool_result',
        data: { id: tc.id, name: tc.name, output: result.output, success: result.success },
      };

      // Сохраняем tool_result
      await saveMessage(sessionId, 'tool_result', result.output, tc.name, tc.id);

      // Добавляем в messages для следующей итерации
      // Anthropic формат: assistant с tool_use, потом user с tool_result
      messages.push({
        role: 'assistant',
        content: [
          ...(response.text ? [{ type: 'text' as const, text: response.text }] : []),
          { type: 'tool_use' as const, id: tc.id, name: tc.name, input: tc.input },
        ],
      });
      messages.push({
        role: 'user',
        content: [
          { type: 'tool_result' as const, tool_use_id: tc.id, content: result.output },
        ],
      });
    }
  }

  // Обновляем timestamp сессии
  await db.update(schema.agentSessions)
    .set({ updatedAt: new Date().toISOString() })
    .where(eq(schema.agentSessions.id, sessionId));

  yield { type: 'done', data: {} };
}

// --- Streaming variant ---

export async function* processMessageStream(
  sessionId: string,
  userMessage: string,
): AsyncGenerator<AgentEvent> {
  // Используем non-streaming вариант с tool loop
  // Streaming от API придёт позже как оптимизация
  yield* processMessage(sessionId, userMessage);
}

// --- Helpers ---

async function saveMessage(
  sessionId: string,
  role: string,
  content: string,
  toolName?: string,
  toolCallId?: string,
  toolArgs?: string,
  toolTier?: ApprovalTier,
): Promise<void> {
  const db = getDb();
  await db.insert(schema.agentMessages).values({
    id: randomUUID(),
    sessionId,
    role,
    content,
    toolName: toolName ?? null,
    toolCallId: toolCallId ?? null,
    toolArgs: toolArgs ?? null,
    toolTier: toolTier ?? null,
    createdAt: new Date().toISOString(),
  });
}

function buildLLMMessages(history: AgentMessage[]): LLMMessage[] {
  const messages: LLMMessage[] = [];

  for (const msg of history) {
    if (msg.role === 'user') {
      messages.push({ role: 'user', content: msg.content });
    } else if (msg.role === 'assistant') {
      messages.push({ role: 'assistant', content: msg.content });
    }
    // tool_call и tool_result пропускаем — они восстанавливаются в processMessage
  }

  return messages;
}

async function requestApproval(
  sessionId: string,
  toolCall: { id: string; name: string; input: Record<string, unknown> },
  tier: ApprovalTier,
  _emit: (evt: AgentEvent) => void,
): Promise<boolean> {
  if (tier === 'auto') return true;
  if (tier === 'notify') return true; // auto-approve but logged

  const db = getDb();
  const approvalId = randomUUID();

  await db.insert(schema.agentApprovals).values({
    id: approvalId,
    sessionId,
    toolName: toolCall.name,
    toolArgs: JSON.stringify(toolCall.input),
    tier,
    status: 'pending',
    reason: null,
    resolvedAt: null,
    createdAt: new Date().toISOString(),
  });

  // Ожидаем решения пользователя (timeout 5 минут)
  return new Promise<boolean>((resolve) => {
    pendingApprovals.set(approvalId, {
      resolve,
      request: {
        id: approvalId,
        sessionId,
        toolName: toolCall.name,
        toolArgs: JSON.stringify(toolCall.input),
        tier,
        status: 'pending',
        reason: null,
        resolvedAt: null,
        createdAt: new Date().toISOString(),
      },
    });

    // Timeout — auto-deny через 5 минут
    setTimeout(() => {
      if (pendingApprovals.has(approvalId)) {
        pendingApprovals.delete(approvalId);
        resolve(false);
        // Обновляем в БД
        db.update(schema.agentApprovals)
          .set({ status: 'expired', resolvedAt: new Date().toISOString() })
          .where(eq(schema.agentApprovals.id, approvalId))
          .then(() => {});
      }
    }, 5 * 60_000);
  });
}
