import type { QuestionAnswer } from '@opencode-ai/sdk/v2/client';

export type ConnectionStatus = 'connected' | 'connecting' | 'disconnected' | 'error';

export type ContextChip = {
  type: 'file' | 'selection';
  path: string;
  range?: { startLine: number; endLine: number };
  content?: string;
};

export type DraftModel = {
  providerID: string;
  modelID: string;
};

export type DraftSelection = {
  agent?: string;
  model?: DraftModel;
  variant?: string;
};

export type AgentOption = {
  name: string;
  description?: string;
  mode: 'subagent' | 'primary' | 'all';
  hidden?: boolean;
  model?: DraftModel;
  variant?: string;
};

export type ModelOption = {
  id: string;
  name: string;
  providerID: string;
  providerName: string;
  variants: string[];
  contextLimit?: number;
};

export type SessionUsageState = {
  totalTokens?: number;
  inputTokens: number;
  outputTokens: number;
  reasoningTokens: number;
  cacheReadTokens: number;
  cacheWriteTokens: number;
  cost?: number;
};

export type SessionStatusDetails = {
  messageCount: number;
  userMessageCount: number;
  assistantMessageCount: number;
  contextCount: number;
  contextLimit?: number;
  usage?: SessionUsageState;
};

export type DraftOptions = {
  models: ModelOption[];
  providerDefaults: Record<string, string>;
  agents: AgentOption[];
  selection: DraftSelection;
};

export type SessionSummary = {
  id: string;
  directory: string;
  title: string;
  updatedAt: number;
};

export type SessionStatusState =
  | { type: 'idle' }
  | { type: 'busy' }
  | { type: 'retry'; attempt: number; message: string; next: number };

export type PermissionState = {
  id: string;
  sessionID: string;
  permission: string;
  patterns: string[];
};

export type QuestionOptionState = {
  label: string;
  description: string;
};

export type QuestionItemState = {
  question: string;
  header: string;
  options: QuestionOptionState[];
  multiple?: boolean;
};

export type QuestionState = {
  id: string;
  sessionID: string;
  questions: QuestionItemState[];
};

export type DiffState = {
  file: string;
  patch: string;
  additions: number;
  deletions: number;
  status?: 'added' | 'deleted' | 'modified';
};

export type MessageSummary = {
  id: string;
  sessionID: string;
  role: 'user' | 'assistant';
  createdAt: number;
  completedAt?: number;
  parentID?: string;
  agent?: string;
  model?: DraftModel;
  variant?: string;
};

export type TextPartState = {
  id: string;
  messageID: string;
  type: 'text';
  text: string;
};

export type ReasoningPartState = {
  id: string;
  messageID: string;
  type: 'reasoning';
  text: string;
};

export type ToolPartState = {
  id: string;
  messageID: string;
  type: 'tool';
  tool: string;
  status: string;
  title?: string;
};

export type SubtaskPartState = {
  id: string;
  messageID: string;
  type: 'subtask';
  description: string;
};

export type AgentPartState = {
  id: string;
  messageID: string;
  type: 'agent';
  name: string;
};

export type RetryPartState = {
  id: string;
  messageID: string;
  type: 'retry';
  message: string;
};

export type PatchPartState = {
  id: string;
  messageID: string;
  type: 'patch';
  files: string[];
};

export type UnknownPartState = {
  id: string;
  messageID: string;
  type: 'unknown';
};

export type TranscriptPartState =
  | TextPartState
  | ReasoningPartState
  | ToolPartState
  | SubtaskPartState
  | AgentPartState
  | RetryPartState
  | PatchPartState
  | UnknownPartState;

export type TranscriptMessage = {
  info: MessageSummary;
  parts: TranscriptPartState[];
};

export type SessionState = {
  info: SessionSummary;
  status: SessionStatusState;
  details: SessionStatusDetails;
  messages: TranscriptMessage[];
  pendingPermissions: PermissionState[];
  pendingQuestions: QuestionState[];
  diffs: DiffState[];
};

export type SessionSnapshotPayload = {
  activeSessionId: string | null;
  sessions: SessionState[];
};

export type PersistedWebviewState = {
  activeSessionId: string | null;
  draft: DraftSelection;
  contextChips: ContextChip[];
  lastError?: string;
};

export type QuestionAnswerState = QuestionAnswer[];
