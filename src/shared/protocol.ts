/*
 * Defines the typed message protocol exchanged between the extension host and webview.
 */
import type {
  ConnectionStatus,
  ContextChip,
  DraftOptions,
  DraftSelection,
  QuestionAnswerState,
  SessionSnapshotPayload,
} from "./models";

export type ConnectionStatePayload = {
  status: ConnectionStatus;
  error?: string;
};

export type ContextPreviewPayload = ContextChip;

export type ErrorPayload = {
  message: string;
};

export type BootstrapPayload = {
  connectionStatus: ConnectionStatus;
  draft: DraftOptions;
} & SessionSnapshotPayload;

export type PromptAttachment = ContextChip;

export type SendPromptPayload = {
  text: string;
  attachments: PromptAttachment[];
  draft?: DraftSelection;
};

export type HostMessage =
  | { type: "bootstrap"; payload: BootstrapPayload }
  | { type: "connection.state"; payload: ConnectionStatePayload }
  | { type: "session.snapshot"; payload: SessionSnapshotPayload }
  | { type: "draft.state"; payload: DraftOptions }
  | { type: "context.preview"; payload: ContextPreviewPayload }
  | { type: "error"; payload: ErrorPayload };

export type PermissionDecisionPayload = {
  requestID: string;
  remember?: boolean;
};

export type QuestionAnswerPayload = {
  requestID: string;
  answers: QuestionAnswerState;
};

export type WebviewMessage =
  | { type: "ready" }
  | { type: "debug.log"; payload: { message: string } }
  | { type: "host.ack"; payload: { messageType: HostMessage["type"] } }
  | { type: "session.new" }
  | { type: "session.switch"; payload: { sessionID: string } }
  | { type: "session.archive"; payload: { sessionID: string } }
  | { type: "message.raw.open"; payload: { sessionID: string; messageID: string } }
  | { type: "draft.set"; payload: DraftSelection }
  | { type: "context.sync"; payload: { chips: ContextChip[] } }
  | { type: "prompt.send"; payload: SendPromptPayload }
  | { type: "session.abort"; payload: { sessionID: string } }
  | { type: "session.compact"; payload: { sessionID: string } }
  | { type: "turn.revert"; payload: { sessionID: string; messageID: string } }
  | { type: "permission.approve"; payload: PermissionDecisionPayload }
  | { type: "permission.deny"; payload: PermissionDecisionPayload }
  | { type: "question.answer"; payload: QuestionAnswerPayload }
  | { type: "context.attachActiveFile" }
  | { type: "context.attachSelection" }
  | { type: "file.open"; payload: { sessionID: string; path: string } }
  | { type: "diff.open"; payload: { sessionID: string; path: string } };
