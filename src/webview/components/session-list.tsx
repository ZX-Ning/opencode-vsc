import type { Component } from 'solid-js';
import { For } from 'solid-js';
import type { SessionState } from '../../shared/models';

type Props = {
  sessions: SessionState[];
  activeSessionId: string | null;
  onSelect: (sessionID: string) => void;
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

export const SessionList: Component<Props> = (props) => {
  return (
    <div class="session-list">
      <div class="section-title">Sessions</div>
      <div class="session-items">
        <For each={props.sessions.length === 0 ? [{ info: { id: 'empty' }, messages: [], pendingPermissions: [], pendingQuestions: [], diffs: [], status: { type: 'idle' } } as unknown as SessionState] : props.sessions}>
          {(session) =>
            session.info.id === 'empty' ? (
              <div class="session-empty">No sessions yet</div>
            ) : (
              <button
                class={`session-item ${session.info.id === props.activeSessionId ? 'session-item-active' : ''}`}
                onClick={() => props.onSelect(session.info.id)}
              >
                <div class="session-item-title">{label(session)}</div>
                <div class="session-item-meta">{subtitle(session)}</div>
              </button>
            )
          }
        </For>
      </div>
    </div>
  );
};
