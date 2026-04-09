import DOMPurify from 'dompurify';
import { marked } from 'marked';
import { For, Show, type Component } from 'solid-js';
import type { TranscriptMessage, TranscriptPartState } from '../../shared/models';

type Props = {
  messages: TranscriptMessage[];
  onRevert: (messageID: string) => void;
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

marked.setOptions({
  gfm: true,
  breaks: true,
});

function renderMarkdown(source: string) {
  const raw = marked.parse(source) as string;
  return DOMPurify.sanitize(raw, {
    FORBID_TAGS: ['img'],
    FORBID_ATTR: ['style', 'onerror', 'onload'],
    ALLOWED_URI_REGEXP: /^$/,
  });
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
              <Show
                when={content}
                fallback={<div class="bubble-text">{running ? 'Working...' : 'No output yet'}</div>}
              >
                <div class="bubble-text markdown-body" innerHTML={renderMarkdown(content)} />
              </Show>
              <Show when={user}>
                <button class="bubble-action" onClick={() => props.onRevert(message.info.id)}>
                  Revert to here
                </button>
              </Show>
            </div>
          );
        }}
      </For>
    </div>
  );
};
