import type { ConnectionStatus, ContextChip, DraftOptions, DraftSelection, QuestionAnswerState, SessionSnapshotPayload } from './models';

export type ConnectionStatePayload = {
  status: ConnectionStatus;
  error?: string;
};

export type SessionPatchPayload =
  | { type: 'upsert'; session: SessionSnapshotPayload['sessions'][number] }
  | { type: 'remove'; sessionID: string };

export type ContextPreviewPayload = ContextChip;

export type PermissionRequestPayload = {
  sessionID: string;
  permission: SessionSnapshotPayload['sessions'][number]['pendingPermissions'][number];
};

export type QuestionRequestPayload = {
  sessionID: string;
  question: SessionSnapshotPayload['sessions'][number]['pendingQuestions'][number];
};

export type ThemePayload = {
  mode: 'light' | 'dark';
};

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
  | { type: 'bootstrap'; payload: BootstrapPayload }
  | { type: 'connection.state'; payload: ConnectionStatePayload }
  | { type: 'session.snapshot'; payload: SessionSnapshotPayload }
  | { type: 'draft.state'; payload: DraftOptions }
  | { type: 'session.patch'; payload: SessionPatchPayload }
  | { type: 'permission.requested'; payload: PermissionRequestPayload }
  | { type: 'question.requested'; payload: QuestionRequestPayload }
  | { type: 'context.preview'; payload: ContextPreviewPayload }
  | { type: 'theme.changed'; payload: ThemePayload }
  | { type: 'error'; payload: ErrorPayload };

export type PermissionDecisionPayload = {
  requestID: string;
  remember?: boolean;
};

export type QuestionAnswerPayload = {
  requestID: string;
  answers: QuestionAnswerState;
};

export type WebviewMessage =
  | { type: 'ready' }
  | { type: 'debug.log'; payload: { message: string } }
  | { type: 'host.ack'; payload: { messageType: HostMessage['type'] } }
  | { type: 'session.new' }
  | { type: 'session.switch'; payload: { sessionID: string } }
  | { type: 'draft.set'; payload: DraftSelection }
  | { type: 'prompt.send'; payload: SendPromptPayload }
  | { type: 'session.abort'; payload: { sessionID: string } }
  | { type: 'turn.retry'; payload: { sessionID: string; messageID: string } }
  | { type: 'permission.approve'; payload: PermissionDecisionPayload }
  | { type: 'permission.deny'; payload: PermissionDecisionPayload }
  | { type: 'question.answer'; payload: QuestionAnswerPayload }
  | { type: 'context.attachActiveFile' }
  | { type: 'context.attachSelection' }
  | { type: 'file.open'; payload: { sessionID: string; path: string } }
  | { type: 'diff.open'; payload: { sessionID: string; path: string } };
