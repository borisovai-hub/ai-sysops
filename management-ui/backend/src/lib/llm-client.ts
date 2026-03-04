import Anthropic from '@anthropic-ai/sdk';
import { spawn } from 'node:child_process';
import type { AgentToolDef } from '@management-ui/shared';
import { logger } from './logger.js';

// --- Types ---

export interface LLMToolCall {
  id: string;
  name: string;
  input: Record<string, unknown>;
}

export interface LLMResponse {
  text: string;
  toolCalls: LLMToolCall[];
  stopReason: string;
  model: string;
  inputTokens: number;
  outputTokens: number;
}

export interface LLMStreamEvent {
  type: 'text_delta' | 'tool_call_start' | 'tool_call_delta' | 'tool_call_end' | 'done';
  text?: string;
  toolCall?: LLMToolCall;
  stopReason?: string;
}

export type LLMMessage = {
  role: 'user' | 'assistant';
  content: string | Anthropic.ContentBlockParam[];
};

// --- Convert tool defs to Anthropic format ---

function toAnthropicTools(tools: AgentToolDef[]): Anthropic.Tool[] {
  return tools.map((t) => ({
    name: t.name,
    description: t.description,
    input_schema: {
      type: 'object' as const,
      properties: Object.fromEntries(
        t.parameters.map((p) => [
          p.name,
          {
            type: p.type,
            description: p.description,
            ...(p.enum ? { enum: p.enum } : {}),
          },
        ]),
      ),
      required: t.parameters.filter((p) => p.required).map((p) => p.name),
    },
  }));
}

// --- Anthropic API Client ---

export class AnthropicClient {
  private client: Anthropic;
  private model: string;

  constructor(apiKey: string, model = 'claude-sonnet-4-20250514') {
    this.client = new Anthropic({ apiKey });
    this.model = model;
  }

  async chat(
    messages: LLMMessage[],
    system: string,
    tools: AgentToolDef[],
  ): Promise<LLMResponse> {
    const response = await this.client.messages.create({
      model: this.model,
      max_tokens: 4096,
      system,
      messages: messages as Anthropic.MessageParam[],
      tools: toAnthropicTools(tools),
    });

    let text = '';
    const toolCalls: LLMToolCall[] = [];

    for (const block of response.content) {
      if (block.type === 'text') {
        text += block.text;
      } else if (block.type === 'tool_use') {
        toolCalls.push({
          id: block.id,
          name: block.name,
          input: block.input as Record<string, unknown>,
        });
      }
    }

    return {
      text,
      toolCalls,
      stopReason: response.stop_reason ?? 'end_turn',
      model: response.model,
      inputTokens: response.usage.input_tokens,
      outputTokens: response.usage.output_tokens,
    };
  }

  async *chatStream(
    messages: LLMMessage[],
    system: string,
    tools: AgentToolDef[],
  ): AsyncGenerator<LLMStreamEvent> {
    const stream = this.client.messages.stream({
      model: this.model,
      max_tokens: 4096,
      system,
      messages: messages as Anthropic.MessageParam[],
      tools: toAnthropicTools(tools),
    });

    const pendingToolCalls = new Map<number, { id: string; name: string; jsonBuf: string }>();

    for await (const event of stream) {
      if (event.type === 'content_block_start') {
        const block = event.content_block;
        if (block.type === 'text') {
          // noop, text comes via deltas
        } else if (block.type === 'tool_use') {
          pendingToolCalls.set(event.index, { id: block.id, name: block.name, jsonBuf: '' });
          yield { type: 'tool_call_start', toolCall: { id: block.id, name: block.name, input: {} } };
        }
      } else if (event.type === 'content_block_delta') {
        const delta = event.delta;
        if (delta.type === 'text_delta') {
          yield { type: 'text_delta', text: delta.text };
        } else if (delta.type === 'input_json_delta') {
          const pending = pendingToolCalls.get(event.index);
          if (pending) pending.jsonBuf += delta.partial_json;
        }
      } else if (event.type === 'content_block_stop') {
        const pending = pendingToolCalls.get(event.index);
        if (pending) {
          let input: Record<string, unknown> = {};
          try { input = JSON.parse(pending.jsonBuf || '{}'); } catch { /* empty */ }
          yield {
            type: 'tool_call_end',
            toolCall: { id: pending.id, name: pending.name, input },
          };
          pendingToolCalls.delete(event.index);
        }
      } else if (event.type === 'message_stop') {
        yield { type: 'done' };
      }
    }
  }
}

// --- Claude CLI Fallback Client ---

export class ClaudeCLIClient {
  private model: string;

  constructor(model = 'sonnet') {
    this.model = model;
  }

  async chat(
    messages: LLMMessage[],
    system: string,
    tools: AgentToolDef[],
  ): Promise<LLMResponse> {
    const prompt = this.buildPrompt(messages, system, tools);
    const result = await this.execCLI(prompt);
    return this.parseResponse(result, tools);
  }

  private buildPrompt(messages: LLMMessage[], system: string, tools: AgentToolDef[]): string {
    const parts: string[] = [];

    // System context
    if (system) {
      parts.push(`<system>\n${system}\n</system>\n`);
    }

    // Tool descriptions
    if (tools.length > 0) {
      parts.push('<tools>');
      for (const t of tools) {
        const params = t.parameters.map((p) =>
          `  - ${p.name} (${p.type}${p.required ? ', required' : ''}): ${p.description}`
        ).join('\n');
        parts.push(`\n${t.name}: ${t.description}\nПараметры:\n${params}\nУровень: ${t.tier}`);
      }
      parts.push('\n</tools>\n');
      parts.push('Ответ строго в JSON: {"text": "...", "tool_call": null | {"name": "...", "arguments": {...}}}\n');
    }

    // Conversation history
    for (const msg of messages) {
      const role = msg.role === 'user' ? 'User' : 'Assistant';
      const content = typeof msg.content === 'string' ? msg.content : JSON.stringify(msg.content);
      parts.push(`${role}: ${content}`);
    }

    return parts.join('\n');
  }

  private execCLI(prompt: string): Promise<string> {
    return new Promise((resolve, reject) => {
      const env = { ...process.env };
      // Удаляем API key чтобы CLI использовал подписку
      delete env.ANTHROPIC_API_KEY;

      const proc = spawn('claude', ['-p', prompt, '--output-format', 'json', '--model', this.model], {
        env,
        stdio: ['pipe', 'pipe', 'pipe'],
        shell: true,
      });

      let stdout = '';
      let stderr = '';

      proc.stdout.on('data', (d: Buffer) => { stdout += d.toString(); });
      proc.stderr.on('data', (d: Buffer) => { stderr += d.toString(); });

      proc.on('close', (code) => {
        if (code !== 0) {
          reject(new Error(`CLI exit ${code}: ${stderr}`));
        } else {
          resolve(stdout);
        }
      });

      proc.on('error', reject);

      // Таймаут 120 секунд
      setTimeout(() => {
        proc.kill();
        reject(new Error('CLI timeout (120s)'));
      }, 120_000);
    });
  }

  private parseResponse(raw: string, _tools: AgentToolDef[]): LLMResponse {
    // Claude CLI --output-format json возвращает: { result: "text", ... }
    let cliOutput: { result?: string; is_error?: boolean };
    try {
      cliOutput = JSON.parse(raw);
    } catch {
      // Fallback: raw text
      return {
        text: raw.trim(),
        toolCalls: [],
        stopReason: 'end_turn',
        model: `cli-${this.model}`,
        inputTokens: 0,
        outputTokens: 0,
      };
    }

    const resultText = cliOutput.result ?? raw;

    // Попробуем распарсить tool_call из JSON-ответа
    try {
      const parsed = JSON.parse(resultText);
      if (parsed && typeof parsed === 'object') {
        const toolCalls: LLMToolCall[] = [];
        if (parsed.tool_call && parsed.tool_call.name) {
          toolCalls.push({
            id: `cli_${Date.now()}`,
            name: parsed.tool_call.name,
            input: parsed.tool_call.arguments ?? {},
          });
        }
        return {
          text: parsed.text ?? '',
          toolCalls,
          stopReason: toolCalls.length > 0 ? 'tool_use' : 'end_turn',
          model: `cli-${this.model}`,
          inputTokens: 0,
          outputTokens: 0,
        };
      }
    } catch { /* not JSON, use as text */ }

    return {
      text: resultText,
      toolCalls: [],
      stopReason: 'end_turn',
      model: `cli-${this.model}`,
      inputTokens: 0,
      outputTokens: 0,
    };
  }
}

// --- Unified client with fallback ---

export class LLMClient {
  private api: AnthropicClient | null;
  private cli: ClaudeCLIClient;
  private useFallback = false;

  constructor(opts: { apiKey?: string; model?: string; cliModel?: string }) {
    this.api = opts.apiKey ? new AnthropicClient(opts.apiKey, opts.model) : null;
    this.cli = new ClaudeCLIClient(opts.cliModel ?? 'sonnet');
  }

  get provider(): string {
    if (!this.api || this.useFallback) return 'cli';
    return 'api';
  }

  async chat(
    messages: LLMMessage[],
    system: string,
    tools: AgentToolDef[],
  ): Promise<LLMResponse> {
    if (this.api && !this.useFallback) {
      try {
        return await this.api.chat(messages, system, tools);
      } catch (err: unknown) {
        if (this.isRetryableError(err)) {
          logger.warn('[LLM] API error, switching to CLI fallback:', (err as Error).message);
          this.useFallback = true;
          // Вернёмся к API через 5 минут
          setTimeout(() => { this.useFallback = false; }, 5 * 60_000);
        } else {
          throw err;
        }
      }
    }
    return this.cli.chat(messages, system, tools);
  }

  async *chatStream(
    messages: LLMMessage[],
    system: string,
    tools: AgentToolDef[],
  ): AsyncGenerator<LLMStreamEvent> {
    if (this.api && !this.useFallback) {
      try {
        yield* this.api.chatStream(messages, system, tools);
        return;
      } catch (err: unknown) {
        if (this.isRetryableError(err)) {
          logger.warn('[LLM] API stream error, switching to CLI fallback:', (err as Error).message);
          this.useFallback = true;
          setTimeout(() => { this.useFallback = false; }, 5 * 60_000);
        } else {
          throw err;
        }
      }
    }
    // CLI не поддерживает streaming — возвращаем как один чанк
    const response = await this.cli.chat(messages, system, tools);
    if (response.text) {
      yield { type: 'text_delta', text: response.text };
    }
    for (const tc of response.toolCalls) {
      yield { type: 'tool_call_end', toolCall: tc };
    }
    yield { type: 'done' };
  }

  private isRetryableError(err: unknown): boolean {
    const msg = err instanceof Error ? err.message : String(err);
    return (
      msg.includes('rate_limit') ||
      msg.includes('overloaded') ||
      msg.includes('billing') ||
      msg.includes('credit') ||
      msg.includes('529') ||
      msg.includes('429')
    );
  }
}
