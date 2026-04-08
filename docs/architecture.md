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
- `EventStream`
- `SessionStore`
- `SidebarProvider`

Registers the `WebviewViewProvider` and commands.

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

- session CRUD
- prompt send/retry/abort
- permissions and questions
- providers and agents lookup

### `src/extension/opencode/event-stream.ts`

Maintains the global event stream and reconnect behavior.

The extension host uses this to incrementally update local session state.

### `src/extension/opencode/session-store.ts`

Host-side source of truth for session state.

Important detail:

- raw SDK objects stay internal here
- `snapshot` exposes webview-safe DTOs from `src/shared/models.ts`

### `src/extension/webview/sidebar-provider.ts`

Owns the VS Code sidebar view.

Responsibilities:

- initialize each resolved `WebviewView`
- handle host/webview messages
- bootstrap lightweight state
- lazily hydrate active session details
- push UI updates to the webview
- manage compatibility fallback if host-to-webview acknowledgement is missing

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
3. Host updates optimistic user message in `SessionStore`.
4. Host calls SDK `promptAsync`.
5. Event stream delivers session/message updates.
6. Host coalesces snapshots and posts to webview.

### Session switch

1. Webview posts `session.switch`.
2. Host updates active session ID.
3. Host restores draft model/agent/variant from that session.
4. If not yet hydrated, host loads full session details lazily.

## Current State Ownership

Host-owned state:

- server connection status
- all OpenCode session data
- providers and agents catalog
- draft defaults and normalization
- workspace/editor context gathering

Webview-owned state:

- persisted local UI selection state via `getState` / `setState`
- temporary chip removal before send
- transient render state

## Important Constraints

1. The webview must not own networking.
2. The host/webview boundary must use plain DTOs only.
3. Sidebar bootstrap must stay lightweight.
4. Streaming updates must be coalesced.
5. Session hydration should stay lazy.
