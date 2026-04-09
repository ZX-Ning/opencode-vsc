import { Component, For } from 'solid-js';
import type { SessionState } from '../../shared/models';
import { Plus, ChevronDown } from './icons';
import { Dropdown } from './dropdown';

interface SidebarHeaderProps {
  connectionStatus: 'connected' | 'connecting' | 'disconnected' | 'error';
  sessions: SessionState[];
  activeSessionId: string | null;
  onNewSession: () => void;
  onSelectSession: (sessionID: string) => void;
}

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

export const SidebarHeader: Component<SidebarHeaderProps> = (props) => {
  const activeSession = () => props.sessions.find(s => s.info.id === props.activeSessionId);
  const activeLabel = () => activeSession() ? label(activeSession()!) : 'New Chat';

  return (
    <div class="sidebar-header">
      <Dropdown
        containerClass="header-dropdown-container"
        menuClass="header-dropdown"
        trigger={({ toggle }) => (
          <button class="header-title-btn" onClick={toggle}>
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
              <For each={props.sessions.length === 0 ? [{ info: { id: 'empty' }, messages: [], pendingPermissions: [], pendingQuestions: [], diffs: [], status: { type: 'idle' } } as unknown as SessionState] : props.sessions}>
                {(session) =>
                  session.info.id === 'empty' ? (
                    <div class="dropdown-item-empty">No sessions yet</div>
                  ) : (
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
                  )
                }
              </For>
            </div>
          </>
        )}
      />

      <div class="status-row" title={`Connection: ${props.connectionStatus}`}>
        <div class={`status-dot status-${props.connectionStatus}`}></div>
      </div>
    </div>
  );
};
