# Architecture

## Overview

This extension is a sidebar-first VS Code client for OpenCode.

The architecture has three major parts:

1. VS Code extension host
2. Sidebar webview (`WebviewView`)
3. OpenCode server (`opencode serve`)

## Runtime Boundary

The extension host owns all communication with OpenCode.

The webview does not talk to the server directly.

This is intentional:

- credentials stay out of the webview
- VS Code-native actions remain in the host
- server lifecycle stays centralized
- the webview becomes simpler and more testable

## Main Components

### `src/extension/extension.ts`

Wires the system together.

Creates:

- `ProcessManager`
- `Client`
- `SessionStore`
- `EventStream`
- `RawMessageDocumentProvider`
- `DiffDocumentProvider`
- `SidebarProvider`

Registers:

- `WebviewViewProvider` for `opencode.sidebar`
- `TextDocumentContentProvider` for `opencode-message` (raw message JSON)
- `TextDocumentContentProvider` for `opencode-diff` (diff before/after content)
- `opencode.focus` command
- `opencode.openCliPathSettings` command

Wires the event stream to the session store and shows warnings on stream errors.

### `src/extension/opencode/process-manager.ts`

Responsible for managed `opencode serve` lifecycle.

Responsibilities:

- resolve CLI path
- spawn server process
- set auth behavior for managed mode
- track process status
- expose logs and errors

### `src/extension/opencode/client.ts`

Thin integration layer on top of `@opencode-ai/sdk`.

Responsibilities:

- session CRUD (create, get, list, archive) and hydration (messages, diffs, todos)
- prompt send, abort, compact, and revert
- permissions and questions
- providers, default agent, and agents lookup

### `src/extension/opencode/event-stream.ts`

Maintains the global event stream and reconnect behavior.

The extension host uses this to incrementally update local session state.

### `src/extension/opencode/session-store.ts`

Host-side source of truth for session state.

Important detail:

- raw SDK objects stay internal here
- `snapshot` exposes webview-safe DTOs from `src/shared/models.ts`
- `handleEvent` processes incoming SSE events and updates local state
- `serialize` applies revert filtering: when a session has a revert point, messages and pending items past that point are excluded from the DTO output

### `src/extension/vscode/workspace-context.ts`

Reads VS Code editor state and turns it into attachable OpenCode context chips.

Responsibilities:

- return the active file as a relative-path `ContextChip`
- return the current selection as a `ContextChip` with 1-based inclusive line range
- fall back from the active editor to any visible editor so attach actions remain usable

### `src/extension/vscode/raw-message-document-provider.ts`

Virtual document provider for raw OpenCode message payloads.

URI scheme: `opencode-message`

Used when the user clicks "Raw" on a transcript message. The host fetches the full message from the SDK, formats it as pretty-printed JSON, and opens it as a readonly document in the editor.

### `src/extension/vscode/diff-document-provider.ts`

Virtual document provider for patch before/after content.

URI scheme: `opencode-diff`

Used when the user opens a diff from the changed files list. The host parses the unified diff patch into before and after content, registers both as virtual documents, and opens them in VS Code's built-in diff editor.

### `src/extension/webview/sidebar-provider.ts`

Owns the VS Code sidebar view.

Responsibilities:

- initialize each resolved `WebviewView`
- handle host/webview messages (all 20 webview message types)
- bootstrap lightweight state
- lazily hydrate active session details
- push UI updates to the webview
- keep fallback HTML state aligned with mirrored webview-local state when needed
- manage compatibility fallback if host-to-webview acknowledgement is missing
- open files in the editor with path traversal protection (validates path is within workspace root)
- open diffs in VS Code's diff editor by parsing unified diff patches
- open raw message JSON as readonly virtual documents

### `src/extension/webview/draft-store.ts`

Tracks model, variant, and agent selection state.

Responsibilities:

- normalize selection
- apply provider defaults
- restore draft state from the active session

### `src/webview/*`

Solid-based sidebar UI.

Responsibilities:

- render host-provided state
- keep only UI-local persisted state
- send user intents to the host

## Data Flow

### Startup

1. Extension activates.
2. Managed server starts.
3. Sidebar webview resolves.
4. Webview sends `ready`.
5. Host sends `connection.state` and `bootstrap`.
6. Webview renders initial state.
7. Host lazily hydrates the active session if needed.

### Prompt send

1. User sends prompt in webview.
2. Webview posts `prompt.send` to host.
3. If needed, host creates a session first.
4. Host forwards the prompt, attachments, and draft selection to the SDK.
5. The webview clears local context chips, and the host mirror stays aligned for fallback reloads.
6. Event stream delivers authoritative session/message updates.
7. Host coalesces snapshots and posts to the webview.

### Session switch

1. Webview posts `session.switch`.
2. Host updates active session ID.
3. Host restores draft model/agent/variant from that session.
4. If not yet hydrated, host loads full session details lazily.

### Archive session

1. Webview posts `session.archive`.
2. Host calls `client.archiveSession()`.
3. Host selects the next available session (or clears if none remain).
4. Session store removes the archived session and emits a change.
5. Webview receives updated snapshot.

### Open file

1. Webview posts `file.open` with session ID and relative path.
2. Host resolves the path against the session's workspace root.
3. Host validates the resolved path does not escape the workspace root (path traversal protection).
4. Host opens the file in the VS Code editor, optionally positioning to a line:column if encoded in the path.

### Open diff

1. Webview posts `diff.open` with session ID and relative file path.
2. Host looks up the diff patch for that file from the session's diff list.
3. Host parses the unified diff to extract before and after content.
4. Host registers both as virtual documents via `DiffDocumentProvider`.
5. Host opens VS Code's built-in diff editor with the two virtual documents.

### Open raw message

1. Webview posts `message.raw.open` with session ID and message ID.
2. Host fetches the full message (info + parts) from the SDK.
3. Host formats it as pretty-printed JSON.
4. Host registers the content via `RawMessageDocumentProvider`.
5. Host opens it as a readonly virtual document in the editor.

## Current State Ownership

Host-owned state:

- server connection status
- all OpenCode session data
- providers and agents catalog
- draft defaults and normalization
- workspace/editor context gathering

Webview-owned state:

- persisted local UI selection state via `getState` / `setState`
- temporary chip edits before send, mirrored back to the host for reload safety
- transient render state

## Important Constraints

1. The webview must not own networking.
2. The host/webview boundary must use plain DTOs only.
3. Sidebar bootstrap must stay lightweight.
4. Streaming updates must be coalesced.
5. Session hydration should stay lazy.
6. File opens must validate paths against the workspace root.

## VS Code Configuration

Three settings are read at runtime (defined in `package.json` contributes):

| setting | type | default | purpose |
|---|---|---|---|
| `opencode.server.url` | string | `http://localhost:13001` | preferred server URL; the port is parsed and used as the starting port for the managed server |
| `opencode.cli.path` | string | `opencode` | path to the `opencode` CLI binary; supports `~` expansion |
| `opencode.server.requireAuth` | boolean | `true` | when true, the managed server is started with HTTP basic auth using a random password |

## Custom URI Schemes

| scheme | provider | purpose |
|---|---|---|
| `opencode-message` | `RawMessageDocumentProvider` | readonly JSON documents for raw message inspection |
| `opencode-diff` | `DiffDocumentProvider` | readonly virtual documents for before/after diff views |

## Webview Security

- The HTML shell uses a strict Content Security Policy with a per-render nonce for scripts.
- Markdown rendering uses `marked` (GFM mode) and `DOMPurify` with a strict allowlist: `<img>` tags are forbidden, `style`/`onerror`/`onload` attributes are stripped, and all URIs are blocked (empty ALLOWED_URI_REGEXP).
- File path references in the transcript are rendered as in-webview buttons that post `file.open` messages to the host, not as direct links.
- The host validates all file paths before opening, ensuring they do not escape the workspace root.
