# OpenCode VS Code Extension Implementation Plan

## Purpose

This document is the build spec for a new sidebar-first VS Code extension for `opencode`.

It is written for both human engineers and AI coding agents. The goal is that a new contributor can read this file and immediately start implementing the extension without needing to rediscover the architecture.

## Product Goal

Build a new `opencode` VS Code extension with a UX closer to GitHub Copilot Chat and Cline:

- sidebar-first chat experience
- streaming transcript
- strong editor/workspace context integration
- inline permission/question handling
- changed files and diff review
- native VS Code file and diff actions

The extension should feel like a first-class VS Code client, not like a wrapper around the terminal UI.

## Core Product Decisions

These decisions are treated as fixed unless this document is updated.

1. Primary surface is a sidebar `WebviewView`.
2. The extension host owns all communication with `opencode`.
3. The webview does not call `opencode` directly.
4. Backend integration uses `opencode serve`, not TUI endpoints.
5. v1 supports one active session per workspace folder.
6. The webview uses Solid so upstream `opencode` UI code is reusable.
7. The full upstream web app will not be embedded wholesale.

## Non-Goals For v1

These features are explicitly deferred.

- multi-session editor tabs
- full parity with the upstream web app
- embedded terminal panel
- multi-root session orchestration beyond basic folder selection
- custom auth UX for every provider
- bundling the entire `opencode` runtime inside the extension
- perfect offline or disconnected mode

## Why This Architecture

The upstream repo already shows three important boundaries.

### 1. The current VS Code extension is terminal-first

Reference:

- `reference/opencode/sdks/vscode/src/extension.ts`

It opens an `opencode` terminal, waits for a local port, and appends prompt text through TUI endpoints. That proves the current official integration is not yet the architecture we want.

### 2. The upstream app is a full standalone product shell

References:

- `reference/opencode/packages/app/src/app.tsx`
- `reference/opencode/packages/app/src/pages/session.tsx`

This app includes routing, desktop-style layouts, terminal panels, multiple app contexts, and a lot of browser/desktop shell concerns. It is useful as a reference, but too large and opinionated to drop into a VS Code sidebar.

### 3. The reusable layer is mostly in `packages/ui`

References:

- `reference/opencode/packages/ui/package.json`
- `reference/opencode/packages/ui/src/components/session-turn.tsx`
- `reference/opencode/packages/ui/src/components/message-part.tsx`
- `reference/opencode/packages/ui/src/components/session-review.tsx`

This is the real reuse boundary. We should reuse or vendor-copy UI pieces from here, while rebuilding the surrounding application shell around VS Code-native constraints.

## High-Level Architecture

```text
VS Code Extension Host
  ├─ manages opencode serve process or external connection
  ├─ owns SDK client and event stream
  ├─ owns session state and workspace context collection
  ├─ performs native VS Code actions
  └─ talks to webview through typed message bridge

Webview Sidebar (Solid)
  ├─ renders transcript and composer
  ├─ renders permission/question cards
  ├─ renders changed files and review UI
  ├─ stores only UI-local state
  └─ sends user intents back to extension host

OpenCode Server
  ├─ opencode serve
  ├─ session APIs
  ├─ file/diff APIs
  ├─ global event stream
  └─ provider/session/permission functionality
```

## Required Build Principles

1. Keep all `opencode` networking in the extension host.
2. Use native VS Code APIs for file open, reveal, diff, notifications, and commands.
3. Avoid porting large upstream layout or routing code.
4. Prefer a small correct implementation over a parity-first implementation.
5. Treat upstream code as reusable source material, not as a black box.
6. Keep v1 single-column and sidebar-optimized.

## Backend Strategy

### Managed Sidecar Mode

The default mode is that the extension starts and owns `opencode serve`.

Reference:

- `reference/opencode/packages/opencode/src/cli/cmd/serve.ts`

The extension should:

- find a usable port
- spawn `opencode serve`
- pass `OPENCODE_SERVER_PASSWORD`
- watch process exit
- poll `/global/health`
- reconnect after restarts
- stop the process on deactivate

### External Server Mode

Advanced users may configure an existing `opencode serve` URL.

This mode should exist in the initial design, even if the first implementation is minimal.

### Security

Reference:

- `reference/opencode/packages/opencode/src/cli/cmd/serve.ts:14-16`

If `OPENCODE_SERVER_PASSWORD` is not set, the server is unsecured. The extension must set it for managed mode.

The extension host should:

- generate a password for managed mode
- use `SecretStorage` for external server secrets if persistence is needed
- never expose server credentials to the webview

## Server API Surface To Rely On

Reference:

- `reference/opencode/packages/sdk/js/package.json`
- `reference/opencode/packages/opencode/src/server/routes/global.ts`
- `reference/opencode/packages/opencode/src/server/routes/session.ts`

Expected primary API surface:

- `@opencode-ai/sdk`
- health endpoint: `/global/health`
- global event stream: `/global/event`
- session CRUD endpoints
- session status endpoints
- session todo endpoints
- session message and diff endpoints

The implementation should prefer the SDK where practical, but may use direct transport control in the extension host for event stream resilience or specialized behavior.

## Reference Map

Use these upstream files as source material.

### Strong references

- `reference/opencode/packages/app/src/context/global-sdk.tsx`
- `reference/opencode/packages/app/src/context/sdk.tsx`
- `reference/opencode/packages/app/src/context/sync.tsx`
- `reference/opencode/packages/app/src/context/permission.tsx`
- `reference/opencode/packages/app/src/context/prompt.tsx`
- `reference/opencode/packages/app/src/components/prompt-input/submit.ts`
- `reference/opencode/packages/ui/src/components/session-turn.tsx`
- `reference/opencode/packages/ui/src/components/message-part.tsx`
- `reference/opencode/packages/ui/src/components/session-review.tsx`
- `reference/opencode/packages/ui/src/components/dock-prompt.tsx`

### Reference only, do not port wholesale

- `reference/opencode/packages/app/src/pages/session.tsx`
- `reference/opencode/packages/app/src/components/prompt-input.tsx`
- `reference/opencode/packages/app/src/pages/session/terminal-panel.tsx`
- `reference/opencode/packages/app/src/pages/session/session-side-panel.tsx`
- `reference/opencode/packages/app/src/pages/layout.tsx`

## Proposed Repo Layout

Create the extension as a single repo with one extension host build and one webview build.

```text
.
├── IMPLEMENTATION_PLAN.md
├── package.json
├── tsconfig.json
├── esbuild.extension.mjs
├── vite.webview.config.ts
├── src
│   ├── shared
│   │   ├── protocol.ts
│   │   ├── models.ts
│   │   ├── events.ts
│   │   └── constants.ts
│   ├── extension
│   │   ├── extension.ts
│   │   ├── commands.ts
│   │   ├── output.ts
│   │   ├── state.ts
│   │   ├── webview
│   │   │   ├── sidebar-provider.ts
```

## Phased Implementation Plan

This legacy plan is kept for historical reference only.
