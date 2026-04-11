import { Component, For } from 'solid-js';
import type { DraftOptions, SessionState, SessionStatusDetails } from '../../shared/models';
import { Plus, ChevronDown, Archive } from './icons';
import { Dropdown } from './dropdown';

interface SidebarHeaderProps {
  connectionStatus: 'connected' | 'connecting' | 'disconnected' | 'error';
  sessions: SessionState[];
  activeSessionId: string | null;
  draft: DraftOptions;
  onNewSession: () => void;
  onSelectSession: (sessionID: string) => void;
  onRequestArchiveSession: (sessionID: string) => void;
  onCompactSession: (sessionID: string) => void;
}

const emptyDetails: SessionStatusDetails = {
  messageCount: 0,
  userMessageCount: 0,
  assistantMessageCount: 0,
  contextCount: 0,
};

function label(session: SessionState) {
  const title = typeof session.info.title === 'string' ? session.info.title.trim() : '';
  if (title) return title;

  const first = session.messages.find((item) => item.info.role === 'user');
  const text = first?.parts.find((part) => part.type === 'text');
  if (text?.type === 'text' && text.text.trim()) return text.text.trim();

  return 'New Chat';
}

function subtitle(session: SessionState) {
  if (session.status?.type === 'busy') return 'Working';
  if (session.status?.type === 'retry') return `Retry ${session.status.attempt}`;

  const date = new Date(typeof session.info.updatedAt === 'number' ? session.info.updatedAt : Date.now());
  return date.toLocaleString([], {
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  });
}

function latestUserModel(session?: SessionState) {
  if (!session) return undefined;
  for (let index = session.messages.length - 1; index >= 0; index -= 1) {
    const message = session.messages[index];
    if (message?.info.role === 'user' && message.info.model) return message.info.model;
  }
  return undefined;
}

function selectedContextLimit(session: SessionState | undefined, draft: DraftOptions) {
  const model = latestUserModel(session) ?? draft.selection.model;
  if (!model) return undefined;

  return draft.models.find((item) => item.providerID === model.providerID && item.id === model.modelID)?.contextLimit;
}

function formatNumber(value?: number) {
  if (typeof value !== 'number' || !Number.isFinite(value)) return undefined;
  return new Intl.NumberFormat().format(Math.round(value));
}

function formatCost(value?: number) {
  if (typeof value !== 'number' || !Number.isFinite(value)) return undefined;
  if (value === 0) return '$0.00';
  if (Math.abs(value) < 0.01) return `$${value.toFixed(4)}`;
  return `$${value.toFixed(2)}`;
}

function contextUsagePercent(details: SessionStatusDetails) {
  if (typeof details.contextLimit !== 'number' || details.contextLimit <= 0) return undefined;
  const raw = (details.contextCount / details.contextLimit) * 100;
  if (!Number.isFinite(raw) || raw < 0) return undefined;
  return Math.min(999, Math.max(0, Math.round(raw)));
}

export const SidebarHeader: Component<SidebarHeaderProps> = (props) => {
  const activeSession = () => props.sessions.find(s => s.info.id === props.activeSessionId);
  const activeLabel = () => activeSession() ? label(activeSession()!) : 'New Chat';
  const statusDetails = () => {
    const session = activeSession();
    const details = session?.details ?? emptyDetails;
    return {
      ...details,
      contextLimit: details.contextLimit ?? selectedContextLimit(session, props.draft),
    };
  };
  const contextPercentLabel = () => {
    const percent = contextUsagePercent(statusDetails());
    return typeof percent === 'number' ? `${percent}%` : '--';
  };

  return (
    <div class="sidebar-header">
      <Dropdown
        containerClass="header-dropdown-container"
        menuClass="header-dropdown"
        trigger={(triggerProps) => (
          <button
            class="header-title-btn"
            onClick={triggerProps.toggle}
            aria-expanded={triggerProps['aria-expanded']}
            aria-haspopup={triggerProps['aria-haspopup']}
            ref={triggerProps.ref}
          >
            <span class="header-title-text">{activeLabel()}</span>
            <ChevronDown size={14} class="header-title-icon" />
          </button>
        )}
        menu={({ close }) => (
          <>
            <div class="dropdown-header">
              <span class="dropdown-header-title">Chats</span>
              <button 
                class="btn btn-icon btn-small" 
                title="New Chat"
                onClick={() => {
                  close();
                  props.onNewSession();
                }}
              >
                <Plus size={14} />
              </button>
            </div>
            <div class="dropdown-list">
              <For each={props.sessions.length === 0 ? [{ info: { id: 'empty' }, messages: [], pendingPermissions: [], pendingQuestions: [], diffs: [], status: { type: 'idle' }, details: emptyDetails } as unknown as SessionState] : props.sessions}>
                {(session) =>
                  session.info.id === 'empty' ? (
                    <div class="dropdown-item-empty">No sessions yet</div>
                  ) : (
                    <div class={`dropdown-item-row ${session.info.id === props.activeSessionId ? 'dropdown-item-row-active' : ''}`}>
                      <button
                        class={`dropdown-item ${session.info.id === props.activeSessionId ? 'dropdown-item-active' : ''}`}
                        onClick={() => {
                          close();
                          props.onSelectSession(session.info.id);
                        }}
                      >
                        <div class="dropdown-item-title">{label(session)}</div>
                        <div class="dropdown-item-meta">{subtitle(session)}</div>
                      </button>
                      <button
                        class="session-archive-btn"
                        type="button"
                        title="Archive chat"
                        aria-label={`Archive ${label(session)}`}
                        onClick={(event) => {
                          event.stopPropagation();
                          close();
                          props.onRequestArchiveSession(session.info.id);
                        }}
                      >
                        <Archive size={13} />
                      </button>
                    </div>
                  )
                }
              </For>
            </div>
          </>
        )}
      />

      <div class="status-row">
        <Dropdown
          containerClass="status-dropdown-container"
          menuClass="status-dropdown-menu"
          trigger={(triggerProps) => (
            <button
              class="status-summary-btn"
              onClick={triggerProps.toggle}
              aria-expanded={triggerProps['aria-expanded']}
              aria-haspopup={triggerProps['aria-haspopup']}
              ref={triggerProps.ref}
              title={`Context usage: ${contextPercentLabel()}`}
            >
              <span class="status-summary-text">{contextPercentLabel()}</span>
            </button>
          )}
          menu={() => {
            const details = statusDetails();
            return (
              <>
                <div class="dropdown-header">
                  <span class="dropdown-header-title">Status</span>
                </div>
                <div class="status-panel">
                  <div class="status-panel-row">
                    <span class="status-panel-label">Connection</span>
                    <span class="status-panel-value status-panel-connection">
                      <span class={`status-dot status-${props.connectionStatus}`}></span>
                      {props.connectionStatus}
                    </span>
                  </div>
                  <div class="status-panel-row">
                    <span class="status-panel-label">Context</span>
                    <span class="status-panel-value">
                      {formatNumber(details.contextCount) ?? '0'}
                      {details.contextLimit ? ` / ${formatNumber(details.contextLimit)}` : ''}
                    </span>
                  </div>
                  <div class="status-panel-row">
                    <span class="status-panel-label">Messages</span>
                    <span class="status-panel-value">{formatNumber(details.messageCount) ?? '0'}</span>
                  </div>
                  <div class="status-panel-row">
                    <span class="status-panel-label">Assistant turns</span>
                    <span class="status-panel-value">{formatNumber(details.assistantMessageCount) ?? '0'}</span>
                  </div>
                  <div class="status-panel-row">
                    <span class="status-panel-label">Input tokens</span>
                    <span class="status-panel-value">{formatNumber(details.usage?.inputTokens) ?? '0'}</span>
                  </div>
                  <div class="status-panel-row">
                    <span class="status-panel-label">Output tokens</span>
                    <span class="status-panel-value">{formatNumber(details.usage?.outputTokens) ?? '0'}</span>
                  </div>
                  <div class="status-panel-row">
                    <span class="status-panel-label">Reasoning tokens</span>
                    <span class="status-panel-value">{formatNumber(details.usage?.reasoningTokens) ?? '0'}</span>
                  </div>
                  <div class="status-panel-row">
                    <span class="status-panel-label">Cache read</span>
                    <span class="status-panel-value">{formatNumber(details.usage?.cacheReadTokens) ?? '0'}</span>
                  </div>
                  <div class="status-panel-row">
                    <span class="status-panel-label">Cache write</span>
                    <span class="status-panel-value">{formatNumber(details.usage?.cacheWriteTokens) ?? '0'}</span>
                  </div>
                  <div class="status-panel-row">
                    <span class="status-panel-label">Total tokens</span>
                    <span class="status-panel-value">{formatNumber(details.usage?.totalTokens) ?? 'Unavailable'}</span>
                  </div>
                  <div class="status-panel-row">
                    <span class="status-panel-label">Estimated cost</span>
                    <span class="status-panel-value">{formatCost(details.usage?.cost) ?? 'Unavailable'}</span>
                  </div>
                  <button
                    class="status-panel-action"
                    type="button"
                    disabled={!props.activeSessionId}
                    onClick={() => {
                      if (!props.activeSessionId) return;
                      props.onCompactSession(props.activeSessionId);
                    }}
                  >
                    Compact Context
                  </button>
                </div>
              </>
            );
          }}
        />
        <div class="status-row" title={`Connection: ${props.connectionStatus}`}>
          <div class={`status-dot status-${props.connectionStatus}`}></div>
        </div>
      </div>
    </div>
  );
};
