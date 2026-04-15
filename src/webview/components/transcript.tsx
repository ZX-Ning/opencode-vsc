/*
 * Renders transcript messages, including markdown, reasoning blocks, and clickable file references.
 */
import DOMPurify from "dompurify";
import { marked } from "marked";
import { For, Show, type Component } from "solid-js";
import type { TranscriptMessage, TranscriptPartState } from "../../shared/models";

const FILE_TOKEN_PATTERN = /(?:\.{1,2}[\\/])?[A-Za-z0-9_./\\-]+(?::\d+(?::\d+)?)?/g;
const STANDALONE_FILE_NAMES = new Set([
  "brewfile",
  "dockerfile",
  "gemfile",
  "justfile",
  "license",
  "makefile",
  "podfile",
  "procfile",
  "rakefile",
  "readme",
  "vagrantfile",
]);
const KNOWN_FILE_EXTENSIONS = new Set([
  "c",
  "cc",
  "cpp",
  "cs",
  "css",
  "go",
  "h",
  "hpp",
  "html",
  "java",
  "js",
  "json",
  "jsx",
  "kt",
  "lock",
  "lua",
  "md",
  "mjs",
  "php",
  "py",
  "rb",
  "rs",
  "scss",
  "sh",
  "sql",
  "svg",
  "toml",
  "ts",
  "tsx",
  "txt",
  "vue",
  "xml",
  "yaml",
  "yml",
]);

type Props = {
  messages: TranscriptMessage[];
  onOpenFile: (path: string) => void;
  onOpenRawMessage: (messageID: string) => void;
  onRevert: (messageID: string) => void;
};

type ContentSegment = {
  id: string;
  type: "markdown" | "reasoning";
  content: string;
};

/** Filters out synthetic user text that is mostly transport noise rather than useful transcript content. */
function visibleSyntheticUserText(text: string) {
  return (
    text.startsWith("Called the Read tool with the following input:") ||
    text.startsWith("Read tool failed to read ") ||
    text.startsWith("Reading MCP resource:") ||
    text.startsWith("Failed to read MCP resource ")
  );
}

/** Converts transcript parts into the human-readable text blocks shown in each bubble. */
function partText(part: TranscriptPartState, isUser: boolean) {
  if (part.type === "text") {
    if (part.ignored) return undefined;
    if (isUser && part.synthetic && !visibleSyntheticUserText(part.text)) return undefined;
    return part.text;
  }

  if (part.type === "tool") {
    if (part.tool === "question" && part.questionReview?.length) {
      return `**Questions**\n\n${part.questionReview
        .map((item) => `${item.question}\n${item.answers.join(", ") || "(no answer)"}`)
        .join("\n\n")}`;
    }
    return `[tool:${part.tool}] ${part.title ?? part.status}`;
  }

  if (part.type === "subtask") return `[subtask] ${part.description}`;
  if (part.type === "agent") return `[agent] ${part.name}`;
  if (part.type === "retry") return `[retry] ${part.message}`;
  if (part.type === "patch") return `[patch] ${part.files.join(", ")}`;
  if (part.type === "compaction") return "[compact]";
  return undefined;
}

/** Groups consecutive markdown parts together while keeping reasoning as separate sections. */
function contentSegments(message: TranscriptMessage) {
  const isUser = message.info.role === "user";
  const segments: ContentSegment[] = [];
  let markdownParts: string[] = [];
  let markdownID: string | undefined;

  const flushMarkdown = () => {
    const content = markdownParts.filter((value) => value.trim()).join("\n\n");
    if (content) {
      segments.push({
        id: markdownID ?? `markdown-${segments.length}`,
        type: "markdown",
        content,
      });
    }

    markdownParts = [];
    markdownID = undefined;
  };

  for (const part of message.parts) {
    if (part.type === "reasoning") {
      flushMarkdown();
      if (part.text.trim()) {
        segments.push({ id: part.id, type: "reasoning", content: part.text });
      }
      continue;
    }

    const content = partText(part, isUser);
    if (!content?.trim()) continue;

    markdownID ??= part.id;
    markdownParts.push(content);
  }

  flushMarkdown();
  return segments;
}

/** Provides a stable fallback label while a message has no visible renderable parts yet. */
function fallbackLabel(message: TranscriptMessage, running: boolean) {
  if (running) return "Working...";

  return message.info.role === "user" ? "No input" : "No output yet";
}

marked.setOptions({
  gfm: true,
  breaks: true,
});

/** Removes punctuation that should not become part of a detected file link. */
function stripTrailingPunctuation(token: string) {
  const candidate = token.replace(/[\]),.;!?}]+$/g, "");
  return {
    candidate,
    trailing: token.slice(candidate.length),
  };
}

/** Uses conservative heuristics so normal prose is not over-linked as file paths. */
function isLikelyFileName(name: string, strict: boolean) {
  const lower = name.toLowerCase();
  if (STANDALONE_FILE_NAMES.has(lower)) return true;
  if (name.startsWith(".") && /[a-z]/i.test(name)) return true;

  const dot = name.lastIndexOf(".");
  if (dot <= 0 || dot === name.length - 1) return false;

  const ext = name.slice(dot + 1).toLowerCase();
  if (!/^[a-z0-9]+$/i.test(ext) || !/[a-z]/i.test(ext) || ext.length > 10) return false;
  if (!strict) return true;
  return KNOWN_FILE_EXTENSIONS.has(ext);
}

/** Normalizes transcript tokens into relative session file references the host can safely open. */
function normalizeFileReference(token: string) {
  if (!token || token.includes("://")) return undefined;

  const match = token.match(/^(.*?)(?::(\d+)(?::(\d+))?)?$/);
  const rawPath = match?.[1] ?? token;
  const line = match?.[2];
  const column = match?.[3];
  const path = rawPath.replace(/\\/g, "/");
  if (!path || path.startsWith("/") || /^[a-z]:\//i.test(path)) return undefined;

  const normalized = path.replace(/^\.\//, "");
  if (!normalized || normalized.startsWith("../")) return undefined;

  const parts = normalized.split("/").filter(Boolean);
  const name = parts[parts.length - 1];
  if (!name) return undefined;

  const hasSeparator = parts.length > 1;
  if (!isLikelyFileName(name, !hasSeparator)) return undefined;

  if (line && column) return `${normalized}:${line}:${column}`;
  if (line) return `${normalized}:${line}`;
  return normalized;
}

/** Builds a button element so file references can route through the host instead of real hyperlinks. */
function createFileLink(doc: Document, label: string, path: string) {
  const button = doc.createElement("button");
  button.type = "button";
  button.className = "link-button transcript-file-link";
  button.dataset.filePath = path;
  button.textContent = label;
  return button;
}

/** Rewrites plain-text file references inside rendered markdown into host-routed buttons. */
function linkifyFileReferences(html: string) {
  const doc = new DOMParser().parseFromString(`<body>${html}</body>`, "text/html");
  const walker = doc.createTreeWalker(doc.body, NodeFilter.SHOW_TEXT, {
    acceptNode(node) {
      const value = node.textContent;
      const parent = node.parentElement;
      if (!value?.trim()) return NodeFilter.FILTER_REJECT;
      if (parent?.closest("a, pre")) return NodeFilter.FILTER_REJECT;
      return NodeFilter.FILTER_ACCEPT;
    },
  });

  const nodes: Text[] = [];
  while (walker.nextNode()) {
    nodes.push(walker.currentNode as Text);
  }

  for (const node of nodes) {
    const value = node.textContent ?? "";
    const fragment = doc.createDocumentFragment();
    const pattern = new RegExp(FILE_TOKEN_PATTERN.source, "g");
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

/** Parses markdown, sanitizes it, and then post-processes the HTML for file links. */
function renderMarkdown(source: string) {
  const raw = marked.parse(source) as string;
  const safe = DOMPurify.sanitize(raw, {
    FORBID_TAGS: ["img"],
    FORBID_ATTR: ["style", "onerror", "onload"],
    ALLOWED_URI_REGEXP: /^$/,
  });

  return linkifyFileReferences(safe);
}

/** Handles delegated clicks on generated file-link buttons inside transcript HTML. */
function handleFileLinkClick(event: MouseEvent, onOpenFile: (path: string) => void) {
  const target = event.target;
  if (!(target instanceof HTMLElement)) return;

  const button = target.closest("[data-file-path]");
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
          const segments = contentSegments(message);
          const user = message.info.role === "user";
          const running = message.info.role === "assistant" && !message.info.completedAt;

          return (
            <div class={`bubble ${user ? "bubble-user" : "bubble-assistant"}`}>
              <div class="bubble-role">{user ? "You" : "OpenCode"}</div>
              <Show
                when={segments.length > 0}
                fallback={<div class="bubble-text">{fallbackLabel(message, running)}</div>}
              >
                <div class="bubble-content">
                  <For each={segments}>
                    {(segment) =>
                      segment.type === "reasoning" ? (
                        <section class="bubble-thinking">
                          <div class="bubble-thinking-label">Thinking</div>
                          <div
                            class="bubble-text bubble-thinking-text markdown-body"
                            innerHTML={renderMarkdown(segment.content)}
                            onClick={(event) => handleFileLinkClick(event, props.onOpenFile)}
                          />
                        </section>
                      ) : (
                        <div
                          class="bubble-text markdown-body"
                          innerHTML={renderMarkdown(segment.content)}
                          onClick={(event) => handleFileLinkClick(event, props.onOpenFile)}
                        />
                      )
                    }
                  </For>
                </div>
              </Show>
              <div class="bubble-actions">
                <button
                  class="bubble-action"
                  onClick={() => props.onOpenRawMessage(message.info.id)}
                >
                  Raw
                </button>
                <Show when={user}>
                  <button
                    class="bubble-action bubble-action-right"
                    onClick={() => props.onRevert(message.info.id)}
                  >
                    Revert to here
                  </button>
                </Show>
              </div>
            </div>
          );
        }}
      </For>
    </div>
  );
};
