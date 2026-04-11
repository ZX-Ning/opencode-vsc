import DOMPurify from 'dompurify';
import { marked } from 'marked';
import { For, Show, type Component } from 'solid-js';
import type { TranscriptMessage, TranscriptPartState } from '../../shared/models';

const FILE_TOKEN_PATTERN = /(?:\.{1,2}[\\/])?[A-Za-z0-9_./\\-]+(?::\d+(?::\d+)?)?/g;
const STANDALONE_FILE_NAMES = new Set([
  'brewfile',
  'dockerfile',
  'gemfile',
  'justfile',
  'license',
  'makefile',
  'podfile',
  'procfile',
  'rakefile',
  'readme',
  'vagrantfile',
]);
const KNOWN_FILE_EXTENSIONS = new Set([
  'c',
  'cc',
  'cpp',
  'cs',
  'css',
  'go',
  'h',
  'hpp',
  'html',
  'java',
  'js',
  'json',
  'jsx',
  'kt',
  'lock',
  'lua',
  'md',
  'mjs',
  'php',
  'py',
  'rb',
  'rs',
  'scss',
  'sh',
  'sql',
  'svg',
  'toml',
  'ts',
  'tsx',
  'txt',
  'vue',
  'xml',
  'yaml',
  'yml',
]);

type Props = {
  messages: TranscriptMessage[];
  onOpenFile: (path: string) => void;
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
      if (part.type === 'compaction') return '[compact]';
      return undefined;
    })
    .filter((value): value is string => !!value?.trim())
    .join('\n\n');
}

function fallbackLabel(message: TranscriptMessage, running: boolean) {
  if (running) return 'Working...';

  return message.info.role === 'user' ? 'No input' : 'No output yet';
}

marked.setOptions({
  gfm: true,
  breaks: true,
});

function stripTrailingPunctuation(token: string) {
  const candidate = token.replace(/[\]),.;!?}]+$/g, '');
  return {
    candidate,
    trailing: token.slice(candidate.length),
  };
}

function isLikelyFileName(name: string, strict: boolean) {
  const lower = name.toLowerCase();
  if (STANDALONE_FILE_NAMES.has(lower)) return true;
  if (name.startsWith('.') && /[a-z]/i.test(name)) return true;

  const dot = name.lastIndexOf('.');
  if (dot <= 0 || dot === name.length - 1) return false;

  const ext = name.slice(dot + 1).toLowerCase();
  if (!/^[a-z0-9]+$/i.test(ext) || !/[a-z]/i.test(ext) || ext.length > 10) return false;
  if (!strict) return true;
  return KNOWN_FILE_EXTENSIONS.has(ext);
}

function normalizeFileReference(token: string) {
  if (!token || token.includes('://')) return undefined;

  const match = token.match(/^(.*?)(?::(\d+)(?::(\d+))?)?$/);
  const rawPath = match?.[1] ?? token;
  const line = match?.[2];
  const column = match?.[3];
  const path = rawPath.replace(/\\/g, '/');
  if (!path || path.startsWith('/') || /^[a-z]:\//i.test(path)) return undefined;

  const normalized = path.replace(/^\.\//, '');
  if (!normalized || normalized.startsWith('../')) return undefined;

  const parts = normalized.split('/').filter(Boolean);
  const name = parts[parts.length - 1];
  if (!name) return undefined;

  const hasSeparator = parts.length > 1;
  if (!isLikelyFileName(name, !hasSeparator)) return undefined;

  if (line && column) return `${normalized}:${line}:${column}`;
  if (line) return `${normalized}:${line}`;
  return normalized;
}

function createFileLink(doc: Document, label: string, path: string) {
  const button = doc.createElement('button');
  button.type = 'button';
  button.className = 'link-button transcript-file-link';
  button.dataset.filePath = path;
  button.textContent = label;
  return button;
}

function linkifyFileReferences(html: string) {
  const doc = new DOMParser().parseFromString(`<body>${html}</body>`, 'text/html');
  const walker = doc.createTreeWalker(doc.body, NodeFilter.SHOW_TEXT, {
    acceptNode(node) {
      const value = node.textContent;
      const parent = node.parentElement;
      if (!value?.trim()) return NodeFilter.FILTER_REJECT;
      if (parent?.closest('a, pre')) return NodeFilter.FILTER_REJECT;
      return NodeFilter.FILTER_ACCEPT;
    },
  });

  const nodes: Text[] = [];
  while (walker.nextNode()) {
    nodes.push(walker.currentNode as Text);
  }

  for (const node of nodes) {
    const value = node.textContent ?? '';
    const fragment = doc.createDocumentFragment();
    const pattern = new RegExp(FILE_TOKEN_PATTERN.source, 'g');
    let last = 0;
    let hasLink = false;

    for (let match = pattern.exec(value); match; match = pattern.exec(value)) {
      const full = match[0];
      const start = match.index;
      const end = start + full.length;
      const { candidate, trailing } = stripTrailingPunctuation(full);
      const path = normalizeFileReference(candidate);
      if (!path) continue;

      if (start > last) {
        fragment.append(value.slice(last, start));
      }
      fragment.append(createFileLink(doc, candidate, path));
      if (trailing) fragment.append(trailing);
      last = end;
      hasLink = true;
    }

    if (!hasLink) continue;
    if (last < value.length) {
      fragment.append(value.slice(last));
    }
    node.replaceWith(fragment);
  }

  return doc.body.innerHTML;
}

function renderMarkdown(source: string) {
  const raw = marked.parse(source) as string;
  const safe = DOMPurify.sanitize(raw, {
    FORBID_TAGS: ['img'],
    FORBID_ATTR: ['style', 'onerror', 'onload'],
    ALLOWED_URI_REGEXP: /^$/,
  });

  return linkifyFileReferences(safe);
}

function handleFileLinkClick(event: MouseEvent, onOpenFile: (path: string) => void) {
  const target = event.target;
  if (!(target instanceof HTMLElement)) return;

  const button = target.closest('[data-file-path]');
  const path = button instanceof HTMLElement ? button.dataset.filePath : undefined;
  if (!path) return;

  event.preventDefault();
  onOpenFile(path);
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
                fallback={<div class="bubble-text">{fallbackLabel(message, running)}</div>}
              >
                <div
                  class="bubble-text markdown-body"
                  innerHTML={renderMarkdown(content)}
                  onClick={(event) => handleFileLinkClick(event, props.onOpenFile)}
                />
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
