/*
 * Implements the sidebar webview app, including host message handling and UI-local persisted state.
 */
import {
  ErrorBoundary,
  For,
  Index,
  Show,
  createEffect,
  createSignal,
  onCleanup,
  onMount,
} from "solid-js";
import { createStore } from "solid-js/store";
import type { HostMessage, WebviewMessage } from "../shared/protocol";
import type {
  ContextChip,
  DraftOptions,
  PersistedWebviewState,
  SessionState,
  TranscriptPartState,
} from "../shared/models";
import { ChangedFiles } from "./components/changed-files";
import { Composer } from "./components/composer";
import { DraftControls } from "./components/draft-controls";
import { PermissionCard } from "./components/permission-card";
import { QuestionCard } from "./components/question-card";
import { SidebarHeader } from "./components/sidebar-header";
import { Transcript } from "./components/transcript";

const ERROR_DISMISS_MS = 5000;
const AUTO_SCROLL_THRESHOLD_PX = 48;

type VsCodeApi = {
  postMessage: (message: WebviewMessage) => void;
  getState: () => PersistedWebviewState | undefined;
  setState: (state: PersistedWebviewState) => void;
};

declare const acquireVsCodeApi: () => VsCodeApi;

declare global {
  interface Window {
    __OPENCODE_INITIAL_STATE__?: {
      connectionStatus: "connected" | "connecting" | "disconnected" | "error";
      activeSessionId: string | null;
      sessions: SessionState[];
      draft: DraftOptions;
      contextChips: ContextChip[];
      composerHeight?: number | "auto";
      error?: string;
    };
  }
}

const vscode = acquireVsCodeApi();
const initial = window.__OPENCODE_INITIAL_STATE__;
const initialPersisted = vscode.getState();
const pendingHostMessages: HostMessage[] = [];
const hostSubscribers = new Set<(message: HostMessage) => void>();

/** Buffers host messages until the Solid app subscribes after mount. */
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

window.addEventListener("message", (event: MessageEvent<HostMessage>) => {
  enqueueHostMessage(event.data);
});

type State = {
  connectionStatus: "connected" | "connecting" | "disconnected" | "error";
  activeSessionId: string | null;
  sessions: SessionState[];
  draft: DraftOptions;
  contextChips: ContextChip[];
  composerHeight: number | "auto";
  error?: string;
};

const emptyDraft: DraftOptions = {
  models: [],
  providerDefaults: {},
  agents: [],
  selection: initialPersisted?.draft ?? {},
};

/** Clones draft selection objects before persisting them through the VS Code webview API. */
function cloneDraft(draft: DraftOptions["selection"]) {
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

/** Clones chip arrays so persisted webview state never shares mutable references with the store. */
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

/** Detects whether transcript scrolling should stay pinned to the latest content. */
function isNearBottom(element?: HTMLElement) {
  if (!element) return true;
  return (
    element.scrollHeight - element.scrollTop - element.clientHeight <= AUTO_SCROLL_THRESHOLD_PX
  );
}

/** Produces a compact, comparable signature for one transcript part. */
function partSignature(part?: TranscriptPartState) {
  if (!part) return "none";

  switch (part.type) {
    case "text":
      return `text:${part.id}:${part.text.length}:${part.synthetic ? 1 : 0}:${part.ignored ? 1 : 0}`;
    case "reasoning":
      return `reasoning:${part.id}:${part.text.length}`;
    case "tool":
      return `tool:${part.id}:${part.tool}:${part.status}:${part.title ?? ""}:${part.questionReview?.length ?? 0}`;
    case "subtask":
      return `subtask:${part.id}:${part.description}`;
    case "agent":
      return `agent:${part.id}:${part.name}`;
    case "retry":
      return `retry:${part.id}:${part.message.length}`;
    case "patch":
      return `patch:${part.id}:${part.files.length}`;
    case "compaction":
      return `compaction:${part.id}:${part.auto ? 1 : 0}:${part.overflow ? 1 : 0}`;
    case "unknown":
      return `unknown:${part.id}`;
  }
}

/** Collapses the latest visible session content into a signature for auto-scroll decisions. */
function sessionContentSignature(session?: SessionState) {
  if (!session) return undefined;

  const lastMessage = session.messages[session.messages.length - 1];
  const lastPart = lastMessage?.parts[lastMessage.parts.length - 1];

  return [
    session.info.id,
    session.info.updatedAt,
    session.messages.length,
    lastMessage?.info.id ?? "",
    lastMessage?.parts.length ?? 0,
    lastMessage?.info.completedAt ?? "",
    partSignature(lastPart),
    session.pendingPermissions.length,
    session.pendingQuestions.length,
    session.diffs.length,
  ].join(":");
}

/** Coordinates host messages, persisted UI state, and the sidebar render tree. */
export function App() {
  const [inputText, setInputText] = createSignal("");
  const [pendingRevertMessageID, setPendingRevertMessageID] = createSignal<string | undefined>();
  const [pendingArchiveSessionID, setPendingArchiveSessionID] = createSignal<string | undefined>();
  const [isDragging, setIsDragging] = createSignal(false);
  let errorTimer: ReturnType<typeof setTimeout> | undefined;
  let sessionScrollTimer: ReturnType<typeof requestAnimationFrame> | undefined;
  let appBodyRef: HTMLDivElement | undefined;
  let appShellRef: HTMLDivElement | undefined;
  let stickToBottom = true;
  let previousActiveSessionId: string | null | undefined;
  let previousActiveSessionSignature: string | undefined;
  const handleWindowError = (event: ErrorEvent) => {
    console.error(event.error ?? event.message);
    showError(event.message);
    reportAsync(`window.error ${event.message} ${event.filename}:${event.lineno}:${event.colno}`);
  };
  const handleUnhandledRejection = (event: PromiseRejectionEvent) => {
    console.error(event.reason);
    showError(String(event.reason));
    reportAsync(`window.unhandledrejection ${String(event.reason)}`);
  };

  const [state, setState] = createStore<State>({
    connectionStatus: initial?.connectionStatus ?? "disconnected",
    activeSessionId: initialPersisted?.activeSessionId ?? initial?.activeSessionId ?? null,
    sessions: initial?.sessions ?? [],
    draft: initial?.draft ?? emptyDraft,
    contextChips: initialPersisted?.contextChips ?? initial?.contextChips ?? [],
    composerHeight: initialPersisted?.composerHeight ?? initial?.composerHeight ?? "auto",
    error: initialPersisted?.lastError ?? initial?.error,
  });

  const post = (message: WebviewMessage) => {
    vscode.postMessage(message);
  };

  const log = (message: string) => {
    post({ type: "debug.log", payload: { message } });
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
      composerHeight: patch?.composerHeight ?? state.composerHeight,
      lastError: patch?.lastError ?? state.error,
    });
  };

  const updateContextChips = (next: ContextChip[], syncHost = false) => {
    const cloned = cloneChips(next);
    setState("contextChips", cloned);
    persist({ contextChips: cloned });
    if (syncHost) {
      post({ type: "context.sync", payload: { chips: cloned } });
    }
  };

  const chips = () => cloneChips(state.contextChips);

  const scrollToBottom = () => {
    if (sessionScrollTimer) {
      cancelAnimationFrame(sessionScrollTimer);
      sessionScrollTimer = undefined;
    }

    sessionScrollTimer = requestAnimationFrame(() => {
      sessionScrollTimer = undefined;
      if (!appBodyRef) return;
      appBodyRef.scrollTop = appBodyRef.scrollHeight;
      stickToBottom = true;
    });
  };

  const clearError = () => {
    if (errorTimer) {
      clearTimeout(errorTimer);
      errorTimer = undefined;
    }
    setState("error", undefined);
    persist({ lastError: undefined });
  };

  const showError = (message?: string) => {
    if (errorTimer) {
      clearTimeout(errorTimer);
      errorTimer = undefined;
    }

    setState("error", message);
    persist({ lastError: message });

    if (!message) return;

    errorTimer = setTimeout(() => {
      errorTimer = undefined;
      setState("error", undefined);
      persist({ lastError: undefined });
    }, ERROR_DISMISS_MS);
  };

  onMount(() => {
    stickToBottom = isNearBottom(appBodyRef);
    log(`mount active=${state.activeSessionId ?? "<none>"} sessions=${state.sessions.length}`);

    window.addEventListener("error", handleWindowError);
    window.addEventListener("unhandledrejection", handleUnhandledRejection);

    const receive = (message: HostMessage) => {
      try {
        const type = message.type;
        setTimeout(() => {
          try {
            log(`receive ${type}`);
          } catch {}
        }, 0);

        switch (message.type) {
          case "bootstrap":
            setState({
              connectionStatus: message.payload.connectionStatus,
              activeSessionId: message.payload.activeSessionId,
              sessions: message.payload.sessions,
              draft: message.payload.draft,
              error: undefined,
            });
            persist({
              activeSessionId: message.payload.activeSessionId,
              draft: cloneDraft(message.payload.draft.selection),
            });
            post({ type: "host.ack", payload: { messageType: message.type } });
            return;
          case "connection.state":
            setState("connectionStatus", message.payload.status);
            showError(message.payload.error);
            post({ type: "host.ack", payload: { messageType: message.type } });
            return;
          case "session.snapshot":
            setState("activeSessionId", message.payload.activeSessionId);
            setState("sessions", message.payload.sessions);
            post({ type: "host.ack", payload: { messageType: message.type } });
            return;
          case "draft.state":
            setState("draft", message.payload);
            post({ type: "host.ack", payload: { messageType: message.type } });
            return;
          case "context.preview":
            updateContextChips([...state.contextChips, message.payload]);
            post({ type: "host.ack", payload: { messageType: message.type } });
            return;
          case "error":
            showError(message.payload.message);
            post({ type: "host.ack", payload: { messageType: message.type } });
            return;
        }
      } catch (error) {
        console.error(error);
        showError(error instanceof Error ? error.message : String(error));
        reportAsync(
          `webview message error: ${error instanceof Error ? (error.stack ?? error.message) : String(error)}`,
        );
      }
    };

    hostSubscribers.add(receive);
    for (const message of pendingHostMessages.splice(0)) {
      receive(message);
    }
    onCleanup(() => {
      hostSubscribers.delete(receive);
      window.removeEventListener("error", handleWindowError);
      window.removeEventListener("unhandledrejection", handleUnhandledRejection);
      if (errorTimer) {
        clearTimeout(errorTimer);
        errorTimer = undefined;
      }
      if (sessionScrollTimer) {
        cancelAnimationFrame(sessionScrollTimer);
        sessionScrollTimer = undefined;
      }
    });

    log("send ready");
    post({ type: "ready" });
    // Keep the host mirror aligned with persisted local chip state for fallback reloads.
    post({ type: "context.sync", payload: { chips: chips() } });
  });

  createEffect(() => {
    const sessionID = state.activeSessionId;
    const session = sessionID
      ? state.sessions.find((item) => item.info.id === sessionID)
      : undefined;
    const signature = sessionContentSignature(session);

    if (!sessionID || !session || !signature) {
      previousActiveSessionId = sessionID;
      previousActiveSessionSignature = signature;
      return;
    }

    const sessionChanged = previousActiveSessionId !== sessionID;
    const firstObservedContent = previousActiveSessionSignature === undefined;
    const contentChanged = previousActiveSessionSignature !== signature;

    if (sessionChanged || firstObservedContent || (contentChanged && stickToBottom)) {
      scrollToBottom();
    }

    previousActiveSessionId = sessionID;
    previousActiveSessionSignature = signature;
  });

  const activeSession = () =>
    state.sessions.find((session) => session.info.id === state.activeSessionId);

  const restoreInputFromMessage = (messageID: string) => {
    const session = activeSession();
    if (!session) return;

    const message = session.messages.find((item) => item.info.id === messageID);
    if (!message || message.info.role !== "user") return;

    const textPart = message.parts.find((part) => part.type === "text");
    if (textPart && "text" in textPart && typeof textPart.text === "string") {
      setInputText(textPart.text);
    }
  };

  const requestRevert = (messageID: string) => {
    setPendingRevertMessageID(messageID);
  };

  const cancelRevert = () => {
    setPendingRevertMessageID(undefined);
  };

  const confirmRevert = () => {
    const sessionID = state.activeSessionId;
    const messageID = pendingRevertMessageID();
    if (!sessionID || !messageID) return;

    restoreInputFromMessage(messageID);
    post({ type: "turn.revert", payload: { sessionID, messageID } });
    setPendingRevertMessageID(undefined);
  };

  const requestArchive = (sessionID: string) => {
    setPendingArchiveSessionID(sessionID);
  };

  const cancelArchive = () => {
    setPendingArchiveSessionID(undefined);
  };

  const confirmArchive = () => {
    const sessionID = pendingArchiveSessionID();
    if (!sessionID) return;

    post({ type: "session.archive", payload: { sessionID } });
    setPendingArchiveSessionID(undefined);
  };

  const startDragging = (e: MouseEvent) => {
    e.preventDefault();
    setIsDragging(true);

    const composerContainer = appShellRef?.querySelector(".composer-container") as HTMLElement;
    if (!composerContainer) return;

    // Temporarily force height to 0 to read the intrinsic minimum height
    const originalHeight = composerContainer.style.height;
    const originalTransition = composerContainer.style.transition;
    composerContainer.style.transition = "none";
    composerContainer.style.height = "0px";

    // Read the height forced by min-height: min-content
    let absoluteMinHeight = composerContainer.offsetHeight;
    if (absoluteMinHeight < 60) absoluteMinHeight = 100; // Safe fallback

    composerContainer.style.height = originalHeight;

    const startY = e.clientY;
    const startHeight = composerContainer.offsetHeight;

    const maxAvailable = appShellRef?.offsetHeight ?? window.innerHeight;
    const absoluteMaxHeight = maxAvailable - 100; // Leave space for app-body and resizer

    const onMouseMove = (e: MouseEvent) => {
      const delta = startY - e.clientY;
      let newHeight = startHeight + delta;

      if (newHeight < absoluteMinHeight) newHeight = absoluteMinHeight;
      if (newHeight > absoluteMaxHeight) newHeight = absoluteMaxHeight;

      setState("composerHeight", newHeight);
    };

    const onMouseUp = () => {
      setIsDragging(false);
      composerContainer.style.transition = originalTransition;
      persist({ composerHeight: state.composerHeight });
      document.removeEventListener("mousemove", onMouseMove);
      document.removeEventListener("mouseup", onMouseUp);
    };

    document.addEventListener("mousemove", onMouseMove);
    document.addEventListener("mouseup", onMouseUp);
  };

  const archiveSessionLabel = () => {
    const sessionID = pendingArchiveSessionID();
    if (!sessionID) return "this chat";

    const session = state.sessions.find((item) => item.info.id === sessionID);
    if (!session) return "this chat";

    const title = session.info.title.trim();
    return title || "this chat";
  };

  return (
    <ErrorBoundary
      fallback={(error) => <div class="error-banner">Render error: {String(error)}</div>}
    >
      <div class="app-shell" ref={appShellRef}>
        <SidebarHeader
          connectionStatus={state.connectionStatus}
          sessions={state.sessions}
          activeSessionId={state.activeSessionId}
          draft={state.draft}
          onNewSession={() => post({ type: "session.new" })}
          onSelectSession={(sessionID) => post({ type: "session.switch", payload: { sessionID } })}
          onRequestArchiveSession={requestArchive}
          onCompactSession={(sessionID) =>
            post({ type: "session.compact", payload: { sessionID } })
          }
        />

        <Show when={state.error}>
          <div class="error-banner">
            <span class="error-banner-text">{state.error}</span>
            <button
              class="error-banner-close"
              type="button"
              onClick={clearError}
              aria-label="Dismiss error"
            >
              ×
            </button>
          </div>
        </Show>

        <div
          class="app-body"
          ref={appBodyRef}
          onScroll={() => {
            stickToBottom = isNearBottom(appBodyRef);
          }}
        >
          <Transcript
            messages={activeSession()?.messages ?? []}
            onOpenFile={(path) => {
              if (!state.activeSessionId) return;
              post({ type: "file.open", payload: { sessionID: state.activeSessionId, path } });
            }}
            onRevert={requestRevert}
          />

          <div class="cards">
            <For each={activeSession()?.pendingPermissions ?? []}>
              {(permission) => (
                <PermissionCard
                  permission={permission}
                  onApprove={(requestID) =>
                    post({ type: "permission.approve", payload: { requestID } })
                  }
                  onDeny={(requestID) => post({ type: "permission.deny", payload: { requestID } })}
                />
              )}
            </For>

            <Index each={activeSession()?.pendingQuestions ?? []}>
              {(question) => (
                <QuestionCard
                  question={question()}
                  onAnswer={(requestID, answers) =>
                    post({ type: "question.answer", payload: { requestID, answers } })
                  }
                />
              )}
            </Index>
          </div>

          <Show when={(activeSession()?.diffs.length ?? 0) > 0 && state.activeSessionId}>
            <ChangedFiles
              diffs={activeSession()?.diffs ?? []}
              onOpenDiff={(path) => {
                if (!state.activeSessionId) return;
                post({ type: "diff.open", payload: { sessionID: state.activeSessionId, path } });
              }}
            />
          </Show>
        </div>

        <div class="resizer" classList={{ dragging: isDragging() }} onMouseDown={startDragging} />

        <div
          class="composer-container"
          style={{ height: state.composerHeight === "auto" ? "auto" : `${state.composerHeight}px` }}
        >
          <Composer
            text={inputText()}
            onTextChange={setInputText}
            onSend={(text) => {
              post({
                type: "prompt.send",
                payload: { text, attachments: chips(), draft: cloneDraft(state.draft.selection) },
              });
              updateContextChips([], true);
            }}
            contextChips={state.contextChips}
            onRemoveChip={(index) => {
              const next = state.contextChips.filter((_, chipIndex) => chipIndex !== index);
              updateContextChips(next, true);
            }}
            onAttachFile={() => post({ type: "context.attachActiveFile" })}
            onAttachSelection={() => post({ type: "context.attachSelection" })}
            todos={activeSession()?.todos ?? []}
            isBusy={activeSession()?.status?.type === "busy"}
            onInterrupt={() => {
              if (state.activeSessionId) {
                post({ type: "session.abort", payload: { sessionID: state.activeSessionId } });
              }
            }}
          >
            <DraftControls
              models={state.draft.models}
              agents={state.draft.agents}
              selection={state.draft.selection}
              onChange={(draft) => {
                const next = cloneDraft(draft);
                setState("draft", "selection", next);
                persist({ draft: next });
                post({ type: "draft.set", payload: next });
              }}
            />
          </Composer>
        </div>

        <Show when={pendingRevertMessageID()}>
          <div class="modal-overlay" role="presentation" onClick={cancelRevert}>
            <div
              class="confirm-dialog"
              role="dialog"
              aria-modal="true"
              aria-labelledby="revert-dialog-title"
              aria-describedby="revert-dialog-description"
              onClick={(event) => event.stopPropagation()}
            >
              <div class="card-title" id="revert-dialog-title">
                Confirm Revert
              </div>
              <div class="confirm-dialog-body" id="revert-dialog-description">
                Later messages will be removed from the conversation and this prompt will be copied
                back into the composer.
              </div>
              <div class="confirm-dialog-actions">
                <button class="btn btn-secondary btn-small" type="button" onClick={cancelRevert}>
                  Cancel
                </button>
                <button class="btn btn-primary btn-small" type="button" onClick={confirmRevert}>
                  Revert
                </button>
              </div>
            </div>
          </div>
        </Show>

        <Show when={pendingArchiveSessionID()}>
          <div class="modal-overlay" role="presentation" onClick={cancelArchive}>
            <div
              class="confirm-dialog"
              role="dialog"
              aria-modal="true"
              aria-labelledby="archive-dialog-title"
              aria-describedby="archive-dialog-description"
              onClick={(event) => event.stopPropagation()}
            >
              <div class="card-title" id="archive-dialog-title">
                Confirm Archive
              </div>
              <div class="confirm-dialog-body" id="archive-dialog-description">
                Archive {archiveSessionLabel()} and remove it from the session list?
              </div>
              <div class="confirm-dialog-actions">
                <button class="btn btn-secondary btn-small" type="button" onClick={cancelArchive}>
                  Cancel
                </button>
                <button class="btn btn-primary btn-small" type="button" onClick={confirmArchive}>
                  Archive
                </button>
              </div>
            </div>
          </div>
        </Show>
      </div>
    </ErrorBoundary>
  );
}
