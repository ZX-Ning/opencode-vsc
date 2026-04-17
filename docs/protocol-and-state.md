# Protocol And State

## Purpose

This document explains the shared data model and the host/webview message contract.

## Shared DTOs

Shared DTOs live in:

- `src/shared/models.ts`
- `src/shared/protocol.ts`

These are intentionally webview-safe representations.

Do not treat them as exact SDK mirrors.

## Why DTOs Exist

The OpenCode SDK contains rich runtime shapes.

The webview boundary requires plain serializable data.

DTOs solve this by:

- stripping non-essential fields
- normalizing naming and structure
- avoiding clone and persistence issues

## Important DTO Groups

### Core scalars and attachments

- `ConnectionStatus` — union: `"connected" | "connecting" | "disconnected" | "error"`
- `ContextChip` — file or selection attachment: `{ type, path, range?, content? }`
- `DraftModel` — `{ providerID, modelID }` pair identifying one model

### Session and transcript

- `SessionSummary` — lightweight row shown in the session list: `{ id, directory, title, updatedAt }`
- `SessionStatusState` — discriminated union: `idle | busy | retry`
- `SessionStatusDetails` — aggregated counts and token usage for one session
- `SessionUsageState` — per-session token and cost breakdown: input, output, reasoning, cache read/write, total, cost
- `SessionState` — full session payload: info, status, details, messages, todos, pending permissions/questions, diffs
- `SessionSnapshotPayload` — `{ activeSessionId, sessions: SessionState[] }`, used for both bootstrap and incremental updates
- `TranscriptMessage` — `{ info: MessageSummary, parts: TranscriptPartState[], attachments: ContextChip[] }`
- `MessageSummary` — per-message metadata: id, sessionID, role, timestamps, agent, model, variant
- `TranscriptPartState` — discriminated union of all part types (see below)
- `TodoState` — `{ content, status, priority }` for in-session task tracking

### Transcript part types

`TranscriptPartState` is a discriminated union of nine concrete part shapes. Each has `id`, `messageID`, and a `type` discriminant:

- `TextPartState` — `type: "text"`, carries `text`, optional `synthetic` and `ignored` flags
- `ReasoningPartState` — `type: "reasoning"`, carries `text` (shown in collapsible thinking blocks)
- `ToolPartState` — `type: "tool"`, carries `tool` name, `status`, optional `title` and `questionReview`
- `SubtaskPartState` — `type: "subtask"`, carries `description`
- `AgentPartState` — `type: "agent"`, carries `name`
- `RetryPartState` — `type: "retry"`, carries error `message`
- `PatchPartState` — `type: "patch"`, carries `files` list
- `CompactionPartState` — `type: "compaction"`, carries `auto` flag and optional `overflow`
- `UnknownPartState` — `type: "unknown"`, fallback for unrecognized part types

### Draft configuration

- `DraftSelection` — current user-facing selection: `{ agent?, model?: DraftModel, variant? }`
- `DraftOptions` — full catalog plus selection: `{ models, providerDefaults, agents, selection }`
- `AgentOption` — `{ name, description?, mode, hidden?, model?, variant? }`
- `ModelOption` — `{ id, name, providerID, providerName, variants, contextLimit? }`

### Pending interaction state

- `PermissionState` — `{ id, sessionID, permission, patterns }`
- `QuestionState` — `{ id, sessionID, questions: QuestionItemState[] }`
- `QuestionItemState` — `{ question, header, options: QuestionOptionState[], multiple?, custom? }`
- `QuestionOptionState` — `{ label, description }`
- `QuestionAnswerState` — alias for SDK `QuestionAnswer[]`, used when replying to questions
- `DiffState` — `{ file, patch, additions, deletions, status? }`

### Persisted webview state

- `PersistedWebviewState` — `{ activeSessionId, draft: DraftSelection, contextChips, composerHeight?, lastError? }`

This is the state stored through `acquireVsCodeApi().setState()`.

`composerHeight` persists the user's resized composer height across sidebar reloads.

## Protocol Payload Types

These are exported from `src/shared/protocol.ts` and used as message payloads:

- `BootstrapPayload` — `{ connectionStatus, draft: DraftOptions } & SessionSnapshotPayload`
- `ConnectionStatePayload` — `{ status: ConnectionStatus, error? }`
- `ErrorPayload` — `{ message }`
- `ContextPreviewPayload` — alias for `ContextChip`
- `SendPromptPayload` — `{ text, attachments: PromptAttachment[], draft?: DraftSelection }`
- `PromptAttachment` — alias for `ContextChip`
- `PermissionDecisionPayload` — `{ requestID, remember? }`
- `QuestionAnswerPayload` — `{ requestID, answers: QuestionAnswerState }`

## Initial HTML State

The inline state injected by `src/extension/webview/html.ts` is not identical to the live `bootstrap` message.

It is typed as `WebviewState` (`BootstrapPayload & { contextChips, error? }`) and includes:

- `BootstrapPayload` fields (connection status, draft options, active session ID, session list)
- `contextChips` — host-mirrored copy of the webview's local chip list
- `error` — last error message, if any

The webview then merges that with persisted local state from `getState()`.

## Host Messages

Defined in `src/shared/protocol.ts` as `HostMessage`.

There are exactly six host message types:

| type | payload type | purpose |
|---|---|---|
| `bootstrap` | `BootstrapPayload` | full initial state after the webview sends `ready` |
| `connection.state` | `ConnectionStatePayload` | server connection status changes |
| `session.snapshot` | `SessionSnapshotPayload` | incremental session state refresh |
| `draft.state` | `DraftOptions` | updated model/agent catalog and selection |
| `context.preview` | `ContextPreviewPayload` | preview of an attached file or selection |
| `error` | `ErrorPayload` | error message to display in the UI |

The host protocol intentionally stays small. Removed or abandoned message variants should not remain in `HostMessage` unless they are implemented end to end.

### `bootstrap`

Used after the webview sends `ready`.

Contains:

- connection status
- active session ID
- session list with full `SessionState` for each session
- current draft catalog (models, agents, provider defaults) and selection

### `session.snapshot`

Used for incremental state refresh after bootstrap.

Payload is `SessionSnapshotPayload`: `{ activeSessionId, sessions: SessionState[] }`.

The host coalesces frequent updates with a 50ms debounce to avoid flooding the webview during streaming.

This should stay reasonably cheap.

## Webview Messages

Defined as `WebviewMessage`.

There are exactly twenty webview message types:

| type | payload | purpose |
|---|---|---|
| `ready` | (none) | webview mounted and ready to receive messages |
| `host.ack` | `{ messageType }` | acknowledges a received host message |
| `debug.log` | `{ message }` | forwards debug output to the host output channel |
| `session.new` | (none) | create a new session |
| `session.switch` | `{ sessionID }` | switch to a different session |
| `session.archive` | `{ sessionID }` | archive (soft-delete) a session |
| `message.raw.open` | `{ sessionID, messageID }` | open raw JSON view of a message |
| `draft.set` | `DraftSelection` | update model/agent/variant selection |
| `context.sync` | `{ chips: ContextChip[] }` | sync local chip edits back to the host |
| `prompt.send` | `SendPromptPayload` | send a prompt with text, attachments, and draft |
| `session.abort` | `{ sessionID }` | abort a running generation |
| `session.compact` | `{ sessionID }` | compact/summarize session context |
| `turn.revert` | `{ sessionID, messageID }` | revert the session to a specific user message |
| `permission.approve` | `PermissionDecisionPayload` | approve a pending permission request |
| `permission.deny` | `PermissionDecisionPayload` | deny a pending permission request |
| `question.answer` | `QuestionAnswerPayload` | answer a pending question |
| `context.attachActiveFile` | (none) | attach the currently active editor file |
| `context.attachSelection` | (none) | attach the current editor selection |
| `file.open` | `{ sessionID, path }` | open a file in the editor |
| `diff.open` | `{ sessionID, path }` | open a file diff in VS Code's diff editor |

### `context.sync`

Used when the webview changes its local context chip list after a host-provided attach.

This keeps the host-side mirrored chip state aligned with the visible UI so fallback HTML refreshes and webview re-resolves do not restore removed chips.

### `message.raw.open`

Used when the user clicks "Raw" on a transcript message.

The host fetches the full message payload from the SDK, formats it as JSON, and opens it as a readonly virtual document using `RawMessageDocumentProvider` (URI scheme: `opencode-message`).

## Ownership Rules

### Host responsibilities

- authoritative session state
- normalization of SDK data into DTOs
- all OpenCode server interaction
- all VS Code-native side effects (opening files, diffs, documents)
- mirrored copies of fallback-injected local state when required
- path safety validation before opening files

### Webview responsibilities

- render DTOs
- send user intents
- persist only local view state
- sync locally edited mirrored state back to the host when required

Note:

`contextChips` are still edited from the webview, but the host keeps a mirrored copy because the HTML fallback path injects initial state from the host side.

## Event Stream To Store Mapping

The `SessionStore.handleEvent()` method processes incoming server-sent events and updates local state. The complete mapping:

| SSE event type | store action |
|---|---|
| `session.created` | upsert session (or remove if archived) |
| `session.updated` | upsert session (or remove if archived) |
| `session.deleted` | remove session |
| `session.status` | update session status (`idle`, `busy`, `retry`) |
| `session.diff` | replace diff list for the session |
| `message.updated` | upsert message into session |
| `message.removed` | remove message and its parts |
| `message.part.updated` | upsert part into message |
| `message.part.delta` | append delta string to an existing part field |
| `message.part.removed` | remove part from message |
| `permission.asked` | add pending permission to session |
| `permission.replied` | remove pending permission from session |
| `question.asked` | add pending question to session |
| `question.replied` / `question.rejected` | remove pending question from session |
| `todo.updated` | replace todo list for the session |

## Revert Filtering

The `SessionStore` serialize method applies revert filtering:

When a session has `session.info.revert.messageID` set, the store filters out all messages, pending permissions, and pending questions where `id >= revert.messageID`. This ensures the webview never renders soft-deleted content.

## Update Strategy

The current strategy is:

1. bootstrap with summaries
2. lazily hydrate active session details
3. coalesce later `session.snapshot` updates (50ms debounce)

This is deliberate.

Do not return to eager loading of all session transcripts during bootstrap.

## Compatibility Mechanism

The sidebar currently includes a compatibility path:

- webview sends `host.ack` after applying host messages
- host tracks whether messages are being acknowledged
- if not, host may fall back to an HTML refresh (250ms timeout) using the latest serialized state

This is not the ideal long-term path, but it makes the sidebar usable in environments where host-to-webview updates appear unreliable.
