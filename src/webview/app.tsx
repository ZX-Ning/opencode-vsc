import { ErrorBoundary, For, Show, onCleanup, onMount } from 'solid-js';
import { createStore } from 'solid-js/store';
import type { HostMessage, WebviewMessage } from '../shared/protocol';
import type { ContextChip, DraftOptions, PersistedWebviewState, SessionState } from '../shared/models';
import { ChangedFiles } from './components/changed-files';
import { Composer } from './components/composer';
import { DraftControls } from './components/draft-controls';
import { PermissionCard } from './components/permission-card';
import { QuestionCard } from './components/question-card';
import { SessionList } from './components/session-list';
import { SidebarHeader } from './components/sidebar-header';
import { Transcript } from './components/transcript';

type VsCodeApi = {
  postMessage: (message: WebviewMessage) => void;
  getState: () => PersistedWebviewState | undefined;
  setState: (state: PersistedWebviewState) => void;
};

declare const acquireVsCodeApi: () => VsCodeApi;

declare global {
  interface Window {
    __OPENCODE_INITIAL_STATE__?: {
      connectionStatus: 'connected' | 'connecting' | 'disconnected' | 'error';
      activeSessionId: string | null;
      sessions: SessionState[];
      draft: DraftOptions;
      contextChips: ContextChip[];
      error?: string;
    };
  }
}

const vscode = acquireVsCodeApi();
const initial = window.__OPENCODE_INITIAL_STATE__;
const initialPersisted = vscode.getState();
const pendingHostMessages: HostMessage[] = [];
const hostSubscribers = new Set<(message: HostMessage) => void>();

function enqueueHostMessage(message?: HostMessage) {
  if (!message) return;

  if (hostSubscribers.size === 0) {
    pendingHostMessages.push(message);
    return;
  }

  for (const subscriber of hostSubscribers) {
    subscriber(message);
  }
}

window.addEventListener('message', (event: MessageEvent<HostMessage>) => {
  enqueueHostMessage(event.data);
});

window.onmessage = (event: MessageEvent<HostMessage>) => {
  enqueueHostMessage(event.data);
};

self.addEventListener('message', (event: MessageEvent<HostMessage>) => {
  enqueueHostMessage(event.data);
});

type State = {
  connectionStatus: 'connected' | 'connecting' | 'disconnected' | 'error';
  activeSessionId: string | null;
  sessions: SessionState[];
  draft: DraftOptions;
  contextChips: ContextChip[];
  error?: string;
};

const emptyDraft: DraftOptions = {
  models: [],
  providerDefaults: {},
  agents: [],
  selection: initialPersisted?.draft ?? {},
};

function cloneDraft(draft: DraftOptions['selection']) {
  return {
    agent: draft.agent,
    model: draft.model
      ? {
          providerID: draft.model.providerID,
          modelID: draft.model.modelID,
        }
      : undefined,
    variant: draft.variant,
  };
}

function cloneChips(chips: ContextChip[]) {
  return chips.map((chip) => ({
    type: chip.type,
    path: chip.path,
    range: chip.range
      ? {
          startLine: chip.range.startLine,
          endLine: chip.range.endLine,
        }
      : undefined,
    content: chip.content,
  }));
}

export function App() {
  const [state, setState] = createStore<State>({
    connectionStatus: initial?.connectionStatus ?? 'disconnected',
    activeSessionId: initialPersisted?.activeSessionId ?? initial?.activeSessionId ?? null,
    sessions: initial?.sessions ?? [],
    draft: initial?.draft ?? emptyDraft,
    contextChips: initialPersisted?.contextChips ?? initial?.contextChips ?? [],
    error: initialPersisted?.lastError ?? initial?.error,
  });

  const post = (message: WebviewMessage) => {
    vscode.postMessage(message);
  };

  const log = (message: string) => {
    post({ type: 'debug.log', payload: { message } });
  };

  const reportAsync = (message: string) => {
    console.error(message);
    setTimeout(() => {
      try {
        log(message);
      } catch {}
    }, 0);
  };

  const persist = (patch?: Partial<PersistedWebviewState>) => {
    vscode.setState({
      activeSessionId: patch?.activeSessionId ?? state.activeSessionId,
      draft: patch?.draft ?? cloneDraft(state.draft.selection),
      contextChips: patch?.contextChips ?? cloneChips(state.contextChips),
      lastError: patch?.lastError ?? state.error,
    });
  };

  const chips = () => cloneChips(state.contextChips);

  onMount(() => {
    log(`mount active=${state.activeSessionId ?? '<none>'} sessions=${state.sessions.length}`);

    window.addEventListener('error', (event) => {
      console.error(event.error ?? event.message);
      setState('error', event.message);
      reportAsync(`window.error ${event.message} ${event.filename}:${event.lineno}:${event.colno}`);
    });

    window.addEventListener('unhandledrejection', (event) => {
      console.error(event.reason);
      setState('error', String(event.reason));
      reportAsync(`window.unhandledrejection ${String(event.reason)}`);
    });

    const receive = (message: HostMessage) => {
      try {
        const type = message.type;
        setTimeout(() => {
          try {
            log(`receive ${type}`);
          } catch {}
        }, 0);

        switch (message.type) {
          case 'bootstrap':
            setState({
              connectionStatus: message.payload.connectionStatus,
              activeSessionId: state.activeSessionId ?? message.payload.activeSessionId,
              sessions: message.payload.sessions,
              draft: {
                ...message.payload.draft,
                selection: state.draft.selection ?? message.payload.draft.selection,
              },
              error: undefined,
            });
            post({ type: 'host.ack', payload: { messageType: message.type } });
            return;
          case 'connection.state':
            setState('connectionStatus', message.payload.status);
            setState('error', message.payload.error);
            post({ type: 'host.ack', payload: { messageType: message.type } });
            return;
          case 'session.snapshot':
            setState('activeSessionId', message.payload.activeSessionId);
            setState('sessions', message.payload.sessions);
            post({ type: 'host.ack', payload: { messageType: message.type } });
            return;
          case 'draft.state':
            setState('draft', message.payload);
            post({ type: 'host.ack', payload: { messageType: message.type } });
            return;
          case 'context.preview':
            setState('contextChips', (chipsState) => [...chipsState, message.payload]);
            post({ type: 'host.ack', payload: { messageType: message.type } });
            return;
          case 'error':
            setState('error', message.payload.message);
            post({ type: 'host.ack', payload: { messageType: message.type } });
            return;
        }
      } catch (error) {
        console.error(error);
        setState('error', error instanceof Error ? error.message : String(error));
        reportAsync(`webview message error: ${error instanceof Error ? error.stack ?? error.message : String(error)}`);
      }
    };

    hostSubscribers.add(receive);
    for (const message of pendingHostMessages.splice(0)) {
      receive(message);
    }
    onCleanup(() => {
      hostSubscribers.delete(receive);
    });

    log('send ready');
    post({ type: 'ready' });
  });

  const activeSession = () => state.sessions.find((session) => session.info.id === state.activeSessionId);

  return (
    <ErrorBoundary fallback={(error) => <div class="error-banner">Render error: {String(error)}</div>}>
      <div class="app-shell">
        <SidebarHeader
          connectionStatus={state.connectionStatus}
          onNewSession={() => post({ type: 'session.new' })}
        />

        <Show when={state.error}>
          <div class="error-banner">{state.error}</div>
        </Show>

        <div class="app-body">
          <SessionList
            sessions={state.sessions}
            activeSessionId={state.activeSessionId}
            onSelect={(sessionID) => post({ type: 'session.switch', payload: { sessionID } })}
          />

          <DraftControls
            models={state.draft.models}
            agents={state.draft.agents}
            selection={state.draft.selection}
            onChange={(draft) => {
              const next = cloneDraft(draft);
              setState('draft', 'selection', next);
              persist({ draft: next });
              post({ type: 'draft.set', payload: next });
            }}
          />

          <Transcript
            messages={activeSession()?.messages ?? []}
            onRetry={(messageID) => {
              if (!state.activeSessionId) return;
              post({ type: 'turn.retry', payload: { sessionID: state.activeSessionId, messageID } });
            }}
          />

          <div class="cards">
            <For each={activeSession()?.pendingPermissions ?? []}>
              {(permission) => (
                <PermissionCard
                  permission={permission}
                  onApprove={(requestID) => post({ type: 'permission.approve', payload: { requestID } })}
                  onDeny={(requestID) => post({ type: 'permission.deny', payload: { requestID } })}
                />
              )}
            </For>

            <For each={activeSession()?.pendingQuestions ?? []}>
              {(question) => (
                <QuestionCard
                  question={question}
                  onAnswer={(requestID, answers) => post({ type: 'question.answer', payload: { requestID, answers } })}
                />
              )}
            </For>
          </div>

          <Show when={(activeSession()?.diffs.length ?? 0) > 0 && state.activeSessionId}>
            <ChangedFiles
              diffs={activeSession()?.diffs ?? []}
              onOpenFile={(path) => {
                if (!state.activeSessionId) return;
                post({ type: 'file.open', payload: { sessionID: state.activeSessionId, path } });
              }}
              onOpenDiff={(path) => {
                if (!state.activeSessionId) return;
                post({ type: 'diff.open', payload: { sessionID: state.activeSessionId, path } });
              }}
            />
          </Show>
        </div>

        <Composer
          onSend={(text) => {
            post({ type: 'prompt.send', payload: { text, attachments: chips(), draft: cloneDraft(state.draft.selection) } });
            setState('contextChips', []);
            persist({ contextChips: [] });
          }}
          contextChips={state.contextChips}
          onRemoveChip={(index) => {
            setState('contextChips', (chipsState) => {
              const next = chipsState.filter((_, item) => item !== index);
              persist({ contextChips: next });
              return next;
            });
          }}
          onAttachFile={() => post({ type: 'context.attachActiveFile' })}
          onAttachSelection={() => post({ type: 'context.attachSelection' })}
        />
      </div>
    </ErrorBoundary>
  );
}
