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

## Host Messages

Defined in `src/shared/protocol.ts` as `HostMessage`.

Main messages:

- `bootstrap`
- `connection.state`
- `session.snapshot`
- `draft.state`
- `context.preview`
- `error`

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
- `session.new`
- `session.switch`
- `draft.set`
- `prompt.send`
- `permission.approve`
- `permission.deny`
- `question.answer`
- `context.attachActiveFile`
- `context.attachSelection`

## Ownership Rules

### Host responsibilities

- authoritative session state
- normalization of SDK data into DTOs
- all OpenCode server interaction
- all VS Code-native side effects

### Webview responsibilities

- render DTOs
- send user intents
- persist only local view state

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
