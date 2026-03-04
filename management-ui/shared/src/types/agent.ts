// --- Approval tiers ---
export type ApprovalTier = 'auto' | 'notify' | 'approve';
export type ApprovalStatus = 'pending' | 'approved' | 'denied' | 'expired';

// --- Messages ---
export type AgentMessageRole = 'user' | 'assistant' | 'tool_call' | 'tool_result';

export interface AgentMessage {
  id: string;
  sessionId: string;
  role: AgentMessageRole;
  content: string;
  toolName?: string;
  toolCallId?: string;
  toolArgs?: string;
  toolTier?: ApprovalTier;
  createdAt: string;
}

// --- Sessions ---
export interface AgentSession {
  id: string;
  title: string;
  model: string;
  systemPrompt?: string;
  createdAt: string;
  updatedAt: string;
  messageCount?: number;
  lastMessage?: string;
}

// --- Approvals ---
export interface AgentApproval {
  id: string;
  sessionId: string;
  toolName: string;
  toolArgs: string;
  tier: ApprovalTier;
  status: ApprovalStatus;
  reason?: string;
  resolvedAt?: string;
  createdAt: string;
}

// --- SSE Events ---
export type AgentEventType =
  | 'text_delta'
  | 'tool_call'
  | 'tool_result'
  | 'approval_required'
  | 'approval_resolved'
  | 'error'
  | 'done';

export interface AgentEvent {
  type: AgentEventType;
  data: Record<string, unknown>;
}

// --- Tool definitions ---
export interface AgentToolParam {
  name: string;
  type: string;
  description: string;
  required?: boolean;
  enum?: string[];
}

export interface AgentToolDef {
  name: string;
  description: string;
  tier: ApprovalTier;
  parameters: AgentToolParam[];
}

// --- API types ---
export interface ChatRequest {
  sessionId?: string;
  message: string;
  model?: string;
}

export interface CreateSessionRequest {
  title?: string;
  model?: string;
  systemPrompt?: string;
}
