/*
 * Stores host-side session state and converts raw SDK data into webview-safe DTO snapshots.
 */
import { EventEmitter } from 'events';
import type {
  AgentPart,
  AssistantMessage,
  Message,
  Part,
  GlobalEvent,
  PermissionRequest,
  QuestionRequest,
  Session,
  SessionStatus,
  SnapshotFileDiff,
  Todo,
  UserMessage,
} from '@opencode-ai/sdk/v2/client';
import type {
  DiffState,
  MessageSummary,
  PermissionState,
  QuestionState,
  SessionStatusDetails,
  SessionSnapshotPayload,
  SessionState,
  SessionStatusState,
  SessionSummary,
  TodoState,
  TranscriptMessage,
  TranscriptPartState,
} from '../../shared/models';

const idle: SessionStatus = { type: 'idle' };

type Mutable = {
  info: Session;
  status: SessionStatus;
  messages: Message[];
  parts: Map<string, Part[]>;
  todos: Todo[];
  permissions: PermissionRequest[];
  questions: QuestionRequest[];
  diffs: SnapshotFileDiff[];
};

/** Keeps DTO output stable by sorting SDK collections before serializing them. */
function sortById<T extends { id: string }>(items: readonly T[]) {
  return [...items].sort((a, b) => a.id.localeCompare(b.id));
}

/** Inserts or replaces an item without mutating the original collection. */
function upsertById<T extends { id: string }>(items: readonly T[], item: T) {
  const next = [...items];
  const index = next.findIndex((value) => value.id === item.id);
  if (index === -1) {
    next.push(item);
    return sortById(next);
  }
  next[index] = item;
  return next;
}

/** Removes one item by id while preserving the order of everything else. */
function removeById<T extends { id: string }>(items: readonly T[], id: string) {
  return items.filter((item) => item.id !== id);
}

/** Archived sessions are hidden from the sidebar instead of being kept in local state. */
function isArchived(info: Session) {
  return typeof info.time.archived === 'number' && Number.isFinite(info.time.archived);
}

/** Reduces the full SDK session object to the summary shown in the sidebar. */
function toSessionSummary(info: Session): SessionSummary {
  return {
    id: info.id,
    directory: info.directory,
    title: info.title,
    updatedAt: info.time.updated,
  };
}

/** Converts SDK status values into the lightweight protocol shape used by the webview. */
function toStatus(status: SessionStatus): SessionStatusState {
  if (status.type === 'retry') {
    return {
      type: 'retry',
      attempt: status.attempt,
      message: status.message,
      next: status.next,
    };
  }

  return { type: status.type };
}

/** Normalizes user and assistant messages into one summary type for rendering. */
function toMessageSummary(message: Message): MessageSummary {
  if (message.role === 'user') {
    const user = message as UserMessage;
    return {
      id: user.id,
      sessionID: user.sessionID,
      role: 'user',
      createdAt: user.time.created,
      agent: user.agent,
      model: {
        providerID: user.model.providerID,
        modelID: user.model.modelID,
      },
      variant: user.model.variant,
    };
  }

  const assistant = message as AssistantMessage;
    return {
      id: assistant.id,
      sessionID: assistant.sessionID,
      role: 'assistant',
      createdAt: assistant.time.created,
      completedAt: assistant.time.completed,
      parentID: assistant.parentID,
      agent: assistant.agent,
      model: {
        providerID: assistant.providerID,
        modelID: assistant.modelID,
      },
    variant: assistant.variant,
  };
}

/** Aggregates message-level usage into the status summary shown in the header. */
function details(messages: readonly Message[]): SessionStatusDetails {
  let userMessageCount = 0;
  let assistantMessageCount = 0;
  let inputTokens = 0;
  let outputTokens = 0;
  let reasoningTokens = 0;
  let cacheReadTokens = 0;
  let cacheWriteTokens = 0;
  let totalTokens = 0;
  let hasTotalTokens = false;
  let cost = 0;
  let hasCost = false;
  let latestContextTokens = 0;
  let latestCompletionTime = -1;

  for (const message of messages) {
    if (message.role === 'user') {
      userMessageCount += 1;
      continue;
    }

    assistantMessageCount += 1;
    const assistant = message as AssistantMessage;
    inputTokens += assistant.tokens.input;
    outputTokens += assistant.tokens.output;
    reasoningTokens += assistant.tokens.reasoning;
    cacheReadTokens += assistant.tokens.cache.read;
    cacheWriteTokens += assistant.tokens.cache.write;
    if (typeof assistant.tokens.total === 'number') {
      totalTokens += assistant.tokens.total;
      hasTotalTokens = true;
    }
    if (typeof assistant.cost === 'number') {
      cost += assistant.cost;
      hasCost = true;
    }

    const completionTime = assistant.time.completed ?? assistant.time.created;
    const contextTokens = assistant.tokens.input
      + assistant.tokens.output
      + assistant.tokens.reasoning
      + assistant.tokens.cache.read
      + assistant.tokens.cache.write;

    if (completionTime >= latestCompletionTime) {
      latestCompletionTime = completionTime;
      latestContextTokens = contextTokens;
    }
  }

  return {
    messageCount: messages.length,
    userMessageCount,
    assistantMessageCount,
    contextCount: latestContextTokens,
    usage: assistantMessageCount > 0
      ? {
          totalTokens: hasTotalTokens ? totalTokens : undefined,
          inputTokens,
          outputTokens,
          reasoningTokens,
          cacheReadTokens,
          cacheWriteTokens,
          cost: hasCost ? cost : undefined,
        }
      : undefined,
  };
}

/** Keeps diff payloads limited to the fields the webview actually renders. */
function toDiff(diff: SnapshotFileDiff): DiffState {
  return {
    file: diff.file,
    patch: diff.patch,
    additions: diff.additions,
    deletions: diff.deletions,
    status: diff.status,
  };
}

/** Copies permission requests into plain JSON-safe objects. */
function toPermission(permission: PermissionRequest): PermissionState {
  return {
    id: permission.id,
    sessionID: permission.sessionID,
    permission: permission.permission,
    patterns: [...permission.patterns],
  };
}

/** Copies question requests into plain JSON-safe objects for the webview. */
function toQuestion(question: QuestionRequest): QuestionState {
  return {
    id: question.id,
    sessionID: question.sessionID,
    questions: question.questions.map((item) => ({
      question: item.question,
      header: item.header,
      multiple: item.multiple,
      custom: item.custom,
      options: item.options.map((option) => ({
        label: option.label,
        description: option.description,
      })),
    })),
  };
}

/** Narrows todo items to the small UI-facing payload used in the composer. */
function toTodo(todo: Todo): TodoState {
  return {
    content: todo.content,
    status: todo.status,
    priority: todo.priority,
  };
}

/** Extracts answered question summaries from the SDK's question tool metadata when present. */
function toQuestionReview(part: Extract<Part, { type: 'tool' }>) {
  if (part.tool !== 'question') return undefined;
  if (!("metadata" in part.state) || !part.state.metadata || typeof part.state.metadata !== 'object') return undefined;
  if (!("answers" in part.state.metadata) || !Array.isArray(part.state.metadata.answers) || part.state.metadata.answers.length === 0) {
    return undefined;
  }

  const input = part.state.input;
  if (!('questions' in input) || !Array.isArray(input.questions)) return undefined;

  const answers = part.state.metadata.answers.map((entry) => {
    if (!Array.isArray(entry)) return [];
    return entry.filter((value): value is string => typeof value === 'string');
  });

  const items = input.questions
    .map((entry, index) => {
      if (!entry || typeof entry !== 'object' || !('question' in entry) || typeof entry.question !== 'string') return undefined;
      return {
        question: entry.question,
        answers: answers[index] ?? [],
      };
    })
    .filter((value): value is NonNullable<typeof value> => !!value);

  if (items.length === 0) return undefined;
  return items;
}

/** Flattens tool parts into a stable render shape and preserves question answers for review. */
function toToolState(part: Extract<Part, { type: 'tool' }>): TranscriptPartState {
  const status = typeof part.state === 'object' && part.state && 'status' in part.state ? String(part.state.status) : 'unknown';
  const title = typeof part.state === 'object' && part.state && 'title' in part.state && typeof part.state.title === 'string'
    ? part.state.title
    : undefined;

  return {
    id: part.id,
    messageID: part.messageID,
    type: 'tool',
    tool: part.tool,
    status,
    title,
    questionReview: toQuestionReview(part),
  };
}

/** Converts raw SDK parts into the discriminated union consumed by the transcript UI. */
function toPart(part: Part): TranscriptPartState {
  switch (part.type) {
    case 'text':
      return {
        id: part.id,
        messageID: part.messageID,
        type: 'text',
        text: part.text,
        synthetic: part.synthetic,
        ignored: part.ignored,
      };
    case 'reasoning':
      return { id: part.id, messageID: part.messageID, type: 'reasoning', text: part.text };
    case 'tool':
      return toToolState(part);
    case 'subtask':
      return { id: part.id, messageID: part.messageID, type: 'subtask', description: part.description };
    case 'agent':
      return { id: part.id, messageID: part.messageID, type: 'agent', name: (part as AgentPart).name };
    case 'retry':
      return { id: part.id, messageID: part.messageID, type: 'retry', message: part.error.data.message };
    case 'patch':
      return { id: part.id, messageID: part.messageID, type: 'patch', files: [...part.files] };
    case 'compaction':
      return {
        id: part.id,
        messageID: part.messageID,
        type: 'compaction',
        auto: part.auto,
        overflow: part.overflow,
      };
    default:
      return { id: part.id, messageID: part.messageID, type: 'unknown' };
  }
}

export class SessionStore extends EventEmitter {
  private sessions = new Map<string, Mutable>();
  private active: string | null = null;

  get activeSessionId() {
    return this.active;
  }

  set activeSessionId(id: string | null) {
    this.active = id;
    this.emit('change');
  }

  /** Returns the complete webview-safe snapshot, ordered by most recently updated session. */
  get snapshot(): SessionSnapshotPayload {
    return {
      activeSessionId: this.active,
      sessions: [...this.sessions.values()]
        .map((session) => this.serialize(session))
        .sort((a, b) => b.info.updatedAt - a.info.updatedAt),
    };
  }

  getSession(id: string) {
    const session = this.sessions.get(id);
    return session ? this.serialize(session) : undefined;
  }

  /** Clears all cached host state before a fresh bootstrap from the server. */
  bootstrap() {
    this.sessions.clear();
    this.active = null;
    this.emit('change');
  }

  /** Creates or updates one session while preserving any hydrated extras we already loaded. */
  upsertSession(info: Session, extras?: { status?: SessionStatus; pendingPermissions?: PermissionRequest[]; pendingQuestions?: QuestionRequest[]; diffs?: SnapshotFileDiff[]; todos?: Todo[] }) {
    if (isArchived(info)) {
      this.removeSession(info.id);
      return;
    }

    const current = this.sessions.get(info.id);
    if (current) {
      current.info = info;
      if (extras?.status) current.status = extras.status;
      if (extras?.todos) current.todos = [...extras.todos];
      if (extras?.pendingPermissions) current.permissions = sortById(extras.pendingPermissions);
      if (extras?.pendingQuestions) current.questions = sortById(extras.pendingQuestions);
      if (extras?.diffs) current.diffs = [...extras.diffs];
    } else {
      this.sessions.set(info.id, {
        info,
        status: extras?.status ?? idle,
        messages: [],
        parts: new Map(),
        todos: [...(extras?.todos ?? [])],
        permissions: sortById(extras?.pendingPermissions ?? []),
        questions: sortById(extras?.pendingQuestions ?? []),
        diffs: [...(extras?.diffs ?? [])],
      });
    }
    this.emit('change');
  }

  /** Replaces the full hydrated transcript for a session after an explicit load. */
  setMessages(sessionID: string, rows: Array<{ info: Message; parts: Part[] }>) {
    const session = this.sessions.get(sessionID);
    if (!session) return;
    session.messages = sortById(rows.map((row) => row.info));
    session.parts = new Map(rows.map((row) => [row.info.id, sortById(row.parts)]));
    this.emit('change');
  }

  setDiffs(sessionID: string, diffs: SnapshotFileDiff[]) {
    const session = this.sessions.get(sessionID);
    if (!session) return;
    session.diffs = [...diffs];
    this.emit('change');
  }

  setPending(sessionID: string, permissions: PermissionRequest[], questions: QuestionRequest[]) {
    const session = this.sessions.get(sessionID);
    if (!session) return;
    session.permissions = sortById(permissions);
    session.questions = sortById(questions);
    this.emit('change');
  }

  removeSession(sessionID: string) {
    this.sessions.delete(sessionID);
    if (this.active === sessionID) this.active = null;
    this.emit('change');
  }

  /** Applies one incoming global event to the local source of truth. */
  handleEvent(event: GlobalEvent) {
    const payload = event.payload;
    switch (payload.type) {
      case 'session.created':
      case 'session.updated': {
        if (isArchived(payload.properties.info)) {
          this.removeSession(payload.properties.info.id);
          return;
        }
        this.upsertSession(payload.properties.info);
        return;
      }
      case 'session.deleted': {
        this.removeSession(payload.properties.info.id);
        return;
      }
      case 'session.status': {
        const session = this.sessions.get(payload.properties.sessionID);
        if (!session) return;
        session.status = payload.properties.status;
        this.emit('change');
        return;
      }
      case 'session.diff': {
        const session = this.sessions.get(payload.properties.sessionID);
        if (!session) return;
        session.diffs = [...payload.properties.diff];
        this.emit('change');
        return;
      }
      case 'message.updated': {
        const session = this.sessions.get(payload.properties.info.sessionID);
        if (!session) return;
        session.messages = upsertById(session.messages, payload.properties.info);
        this.emit('change');
        return;
      }
      case 'message.removed': {
        const session = this.sessions.get(payload.properties.sessionID);
        if (!session) return;
        session.messages = removeById(session.messages, payload.properties.messageID);
        session.parts.delete(payload.properties.messageID);
        this.emit('change');
        return;
      }
      case 'message.part.updated': {
        const part = payload.properties.part;
        const session = this.sessions.get(part.sessionID);
        if (!session) return;
        const parts = session.parts.get(part.messageID) ?? [];
        session.parts.set(part.messageID, upsertById(parts, part));
        this.emit('change');
        return;
      }
      case 'message.part.delta': {
        const session = this.sessions.get(payload.properties.sessionID);
        if (!session) return;
        const parts = session.parts.get(payload.properties.messageID) ?? [];
        const index = parts.findIndex((part) => part.id === payload.properties.partID);
        if (index === -1) return;
        const current = parts[index];
        const field = payload.properties.field;
        if (typeof current !== 'object' || !(field in current)) return;
        const value = current[field as keyof Part];
        if (typeof value !== 'string') return;
        const next = [...parts];
        next[index] = {
          ...current,
          [field]: value + payload.properties.delta,
        } as Part;
        session.parts.set(payload.properties.messageID, next);
        this.emit('change');
        return;
      }
      case 'message.part.removed': {
        const session = this.sessions.get(payload.properties.sessionID);
        if (!session) return;
        const parts = session.parts.get(payload.properties.messageID) ?? [];
        session.parts.set(payload.properties.messageID, removeById(parts, payload.properties.partID));
        this.emit('change');
        return;
      }
      case 'permission.asked': {
        const session = this.sessions.get(payload.properties.sessionID);
        if (!session) return;
        session.permissions = upsertById(session.permissions, payload.properties);
        this.emit('change');
        return;
      }
      case 'permission.replied': {
        const session = this.sessions.get(payload.properties.sessionID);
        if (!session) return;
        session.permissions = removeById(session.permissions, payload.properties.requestID);
        this.emit('change');
        return;
      }
      case 'question.asked': {
        const session = this.sessions.get(payload.properties.sessionID);
        if (!session) return;
        session.questions = upsertById(session.questions, payload.properties);
        this.emit('change');
        return;
      }
      case 'question.replied':
      case 'question.rejected': {
        const session = this.sessions.get(payload.properties.sessionID);
        if (!session) return;
        session.questions = removeById(session.questions, payload.properties.requestID);
        this.emit('change');
        return;
      }
      case 'todo.updated': {
        const session = this.sessions.get(payload.properties.sessionID);
        if (!session) return;
        session.todos = [...payload.properties.todos];
        this.emit('change');
        return;
      }
    }
  }

  /** Serializes one session and hides any content that lives past a recorded revert point. */
  private serialize(session: Mutable): SessionState {
    let rawMessages = session.messages;
    let rawPermissions = session.permissions;
    let rawQuestions = session.questions;

    const revertMsgId = session.info.revert?.messageID;
    if (revertMsgId) {
      rawMessages = rawMessages.filter((m) => m.id < revertMsgId);
      rawPermissions = rawPermissions.filter((p) => !p.tool?.messageID || p.tool.messageID < revertMsgId);
      rawQuestions = rawQuestions.filter((q) => !q.tool?.messageID || q.tool.messageID < revertMsgId);
    }

    const messages: TranscriptMessage[] = rawMessages.map((info) => ({
      info: toMessageSummary(info),
      parts: sortById(session.parts.get(info.id) ?? []).map(toPart),
    }));

    return {
      info: toSessionSummary(session.info),
      status: toStatus(session.status),
      details: details(rawMessages),
      messages,
      todos: session.todos.map(toTodo),
      pendingPermissions: rawPermissions.map(toPermission),
      pendingQuestions: rawQuestions.map(toQuestion),
      diffs: session.diffs.map(toDiff),
    };
  }
}
