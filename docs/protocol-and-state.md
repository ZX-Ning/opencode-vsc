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

### Session and transcript

- `SessionSummary`
- `SessionState`
- `TranscriptMessage`
- `TranscriptPartState`

### Draft configuration

- `DraftModel`
- `DraftSelection`
- `DraftOptions`
- `AgentOption`
- `ModelOption`

### Pending interaction state

- `PermissionState`
- `QuestionState`
- `DiffState`

### Persisted webview state

- `PersistedWebviewState`

This is the state stored through `acquireVsCodeApi().setState()`.

## Initial HTML State

The inline state injected by `src/extension/webview/html.ts` is not identical to the live `bootstrap` message.

It includes:

- `BootstrapPayload`
- `contextChips`
- `error`

The webview then merges that with persisted local state from `getState()`.

## Host Messages

Defined in `src/shared/protocol.ts` as `HostMessage`.

Main messages:

- `bootstrap`
- `connection.state`
- `session.snapshot`
- `draft.state`
- `context.preview`
- `error`

The host protocol intentionally stays small. Removed or abandoned message variants should not remain in `HostMessage` unless they are implemented end to end.

### `bootstrap`

Used after the webview sends `ready`.

Contains:

- connection status
- active session ID
- session list snapshot
- current draft catalog and selection

### `session.snapshot`

Used for incremental state refresh after bootstrap.

This should stay reasonably cheap.

## Webview Messages

Defined as `WebviewMessage`.

Main messages:

- `ready`
- `host.ack`
- `debug.log`
- `session.new`
- `session.switch`
- `session.archive`
- `draft.set`
- `context.sync`
- `prompt.send`
- `session.abort`
- `session.compact`
- `turn.revert`
- `permission.approve`
- `permission.deny`
- `question.answer`
- `context.attachActiveFile`
- `context.attachSelection`
- `file.open`
- `diff.open`

### `context.sync`

Used when the webview changes its local context chip list after a host-provided attach.

This keeps the host-side mirrored chip state aligned with the visible UI so fallback HTML refreshes and webview re-resolves do not restore removed chips.

## Ownership Rules

### Host responsibilities

- authoritative session state
- normalization of SDK data into DTOs
- all OpenCode server interaction
- all VS Code-native side effects
- mirrored copies of fallback-injected local state when required

### Webview responsibilities

- render DTOs
- send user intents
- persist only local view state
- sync locally edited mirrored state back to the host when required

Note:

`contextChips` are still edited from the webview, but the host keeps a mirrored copy because the HTML fallback path injects initial state from the host side.

## Update Strategy

The current strategy is:

1. bootstrap with summaries
2. lazily hydrate active session details
3. coalesce later `session.snapshot` updates

This is deliberate.

Do not return to eager loading of all session transcripts during bootstrap.

## Compatibility Mechanism

The sidebar currently includes a compatibility path:

- webview sends `host.ack` after applying host messages
- host tracks whether messages are being acknowledged
- if not, host may fall back to an HTML refresh using the latest serialized state

This is not the ideal long-term path, but it makes the sidebar usable in environments where host-to-webview updates appear unreliable.
