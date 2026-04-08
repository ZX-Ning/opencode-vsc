import { For, Show, type Component } from 'solid-js';
import type { TranscriptMessage, TranscriptPartState } from '../../shared/models';

type Props = {
  messages: TranscriptMessage[];
  onRetry: (messageID: string) => void;
};

function text(parts: TranscriptPartState[]) {
  return parts
    .map((part) => {
      if (part.type === 'text') return part.text;
      if (part.type === 'reasoning') return part.text;
      if (part.type === 'tool') {
        return `[tool:${part.tool}] ${part.title ?? part.status}`;
      }
      if (part.type === 'subtask') return `[subtask] ${part.description}`;
      if (part.type === 'agent') return `[agent] ${part.name}`;
      if (part.type === 'retry') return `[retry] ${part.message}`;
      if (part.type === 'patch') return `[patch] ${part.files.join(', ')}`;
      return undefined;
    })
    .filter((value): value is string => !!value?.trim())
    .join('\n\n');
}

export const Transcript: Component<Props> = (props) => {
  return (
    <div class="transcript">
      <For each={props.messages}>
        {(message) => {
          const content = text(message.parts);
          const user = message.info.role === 'user';
          const running = message.info.role === 'assistant' && !message.info.completedAt;

          return (
            <div class={`bubble ${user ? 'bubble-user' : 'bubble-assistant'}`}>
              <div class="bubble-role">{user ? 'You' : 'OpenCode'}</div>
              <div class="bubble-text">{content || (running ? 'Working...' : 'No output yet')}</div>
              <Show when={!user}>
                <button class="bubble-action" onClick={() => props.onRetry(message.info.parentID ?? message.info.id)}>
                  Retry from here
                </button>
              </Show>
            </div>
          );
        }}
      </For>
    </div>
  );
};
