# OpenCode VSC Extension — Full Codebase Review

**Date:** 2026-04-09
**Reviewer:** Claude Opus 4.6
**Scope:** All source files, configuration, build system, and documentation
**Project:** opencode-vsc v0.1.1 — VS Code sidebar extension for the OpenCode AI coding assistant

---

## Table of Contents

1. [Executive Summary](#1-executive-summary)
2. [Architecture Overview](#2-architecture-overview)
3. [Security Vulnerabilities](#3-security-vulnerabilities)
4. [Bugs & Race Conditions](#4-bugs--race-conditions)
5. [Dead Code & Redundancy](#5-dead-code--redundancy)
6. [Code Quality Issues](#6-code-quality-issues)
7. [Performance Concerns](#7-performance-concerns)
8. [Configuration & Build Issues](#8-configuration--build-issues)
9. [Documentation Redundancy](#9-documentation-redundancy)
10. [Suggested Improvements](#10-suggested-improvements)
11. [What the Codebase Does Well](#11-what-the-codebase-does-well)

---

## 1. Executive Summary

The codebase is a well-structured VS Code sidebar extension (~2,500 lines across 20 source files). It uses a clean three-tier architecture (extension host, webview, managed server) with a typed message protocol. The code quality is generally good for an early-stage project, with proper XSS protection, path traversal defense, and clean separation of concerns.

**Key Findings:**

| Category | Critical | Medium | Low |
|----------|----------|--------|-----|
| Security | 0 | 2 | 1 |
| Bugs | 1 | 4 | 3 |
| Dead Code | 0 | 2 | 2 |
| Code Quality | 0 | 3 | 6 |
| Performance | 1 | 2 | 2 |
| Config/Build | 0 | 2 | 3 |

---

## 2. Architecture Overview

```
┌────────────────────┐     postMessage      ┌────────────────────┐
│   Extension Host   │◄────────────────────►│   Webview (Solid)  │
│                    │                       │                    │
│  ProcessManager    │                       │  App (store)       │
│  Client (SDK)      │     SSE + REST        │  Transcript        │
│  EventStream       │◄────────────────────►│  Composer          │
│  SessionStore      │                       │  DraftControls     │
│  SidebarProvider   │                       │  Dropdowns         │
│  DraftStore        │                       │  Cards             │
└────────┬───────────┘                       └────────────────────┘
         │
         │ spawn + HTTP
         ▼
┌────────────────────┐
│  opencode serve    │
│  (managed process) │
└────────────────────┘
```

**File count:** 20 TypeScript/TSX + 1 CSS + 5 config + 7 docs
**Dependencies:** 4 runtime (`@opencode-ai/sdk`, `solid-js`, `marked`, `dompurify`) + 7 dev
**Build:** esbuild (extension) + Vite (webview), single `npm run build` command

---

## 3. Security Vulnerabilities

### SEC-1: Weak Password Generation [Medium]

**File:** `src/extension/opencode/process-manager.ts:136-137`

```typescript
private passwordForServer() {
  return `${Math.random().toString(36).slice(2)}${Math.random().toString(36).slice(2)}`;
}
```

`Math.random()` is not cryptographically secure. An attacker who can predict the PRNG state could forge the server password and send arbitrary prompts.

**Impact:** The server runs on `127.0.0.1` and the password is transmitted only via environment variable and Authorization header over localhost, so the attack surface is limited to local processes. However, if another extension or local process sniffs the PRNG state, the password is predictable.

**Fix:** Use `crypto.randomBytes(24).toString('base64url')` from Node's `crypto` module.

---

### SEC-2: Weak CSP Nonce Generation [Medium]

**File:** `src/extension/webview/html.ts:33-39`

```typescript
function getNonce() {
  let text = '';
  const possible = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  for (let i = 0; i < 32; i++) {
    text += possible.charAt(Math.floor(Math.random() * possible.length));
  }
  return text;
}
```

Same issue — `Math.random()` for CSP nonce generation. The VS Code webview is sandboxed so the practical risk is low, but this pattern is copied from old VS Code extension samples and has been updated in newer official examples to use `crypto`.

**Fix:** `crypto.randomBytes(16).toString('base64')`.

---

### SEC-3: No `event.origin` Check on Message Listener [Low]

**File:** `src/webview/app.tsx:55-57`

```typescript
window.addEventListener('message', (event: MessageEvent<HostMessage>) => {
  enqueueHostMessage(event.data);
});
```

Standard for VS Code webviews (the iframe origin is controlled by VS Code), but deviates from web security best practices. If VS Code's iframe isolation ever has a bug, this would be exploitable.

**Mitigated by:** VS Code's built-in webview sandboxing.

---

### Security Positives

- **XSS prevention** in `transcript.tsx:193-201`: DOMPurify with `FORBID_TAGS: ['img']`, `FORBID_ATTR: ['style', 'onerror', 'onload']`, `ALLOWED_URI_REGEXP: /^$/` is excellent.
- **Path traversal protection** in `sidebar-provider.ts:437-466`: `fs.realpathSync` + `path.relative` validation with symlink resolution.
- **Command injection prevention**: `cp.spawn` with argument arrays, never shell strings.
- **Strong CSP policy** in `html.ts:21`: `default-src 'none'` with nonce-gated scripts.

---

## 4. Bugs & Race Conditions

### BUG-1: `scrollToBottom` Effect Has Broken Reactivity [Critical-Medium]

**File:** `src/webview/app.tsx:274-278`

```typescript
createEffect(() => {
  if (!state.activeSessionId) return;
  void state.sessions;
  scrollToBottom();
});
```

`void state.sessions` accesses the top-level array reference in the SolidJS store, but does **not** track nested changes (e.g., a new message added to an existing session). The effect only fires when `state.sessions` itself is reassigned (which happens on `session.snapshot` messages). When a streaming delta arrives and mutates a session's parts within the same array, the scroll may not trigger.

**Impact:** Users may not see new content auto-scrolled during streaming responses if the snapshot arrives after a visible delay.

**Fix:** Access a more specific reactive property, e.g.:
```typescript
const activeSession = createMemo(() =>
  state.sessions.find(s => s.info.id === state.activeSessionId)
);
createEffect(() => {
  const session = activeSession();
  if (!session) return;
  session.messages.length; // Track message count
  scrollToBottom();
});
```

---

### BUG-2: `loadSession` Hardcodes `status: { type: 'idle' }` [Medium]

**File:** `src/extension/webview/sidebar-provider.ts:316`

```typescript
return {
  info,
  status: { type: 'idle' } as const,
  // ...
};
```

When a session is loaded via `loadSession()`, the status is always set to `idle` regardless of the actual server-side status. If the session was `busy` (e.g., the user opened a new webview while a prompt was running), the UI will show the session as idle until the next SSE status event arrives.

**Impact:** Brief misleading "idle" state for in-progress sessions on webview reload.

**Fix:** The SDK's `getSession` should return the current status. Pass it through instead of hardcoding.

---

### BUG-3: `bootstrap()` Contains Dead Logic [Medium]

**File:** `src/extension/opencode/session-store.ts:215-218`

```typescript
bootstrap() {
  this.sessions.clear();
  if (this.active && !this.sessions.has(this.active)) this.active = null;
  this.emit('change');
}
```

After `this.sessions.clear()`, `this.sessions.has(this.active)` will **always** be `false`. The conditional is therefore equivalent to `if (this.active) this.active = null`, or simply `this.active = null`. This is likely a leftover from a version where `bootstrap()` merged sessions rather than clearing them.

---

### BUG-4: `openDiff` Is a No-Op Alias [Medium]

**File:** `src/extension/webview/sidebar-provider.ts:484-486`

```typescript
private async openDiff(sessionID: string, rel: string) {
  await this.openFile(sessionID, rel);
}
```

The `diff.open` message type exists in the protocol, and the `changed-files.tsx` component could use it, but `openDiff` just calls `openFile`. Users clicking changed files do not get a diff view — they get the raw file. This is either incomplete or should be documented as intentional.

**Fix:** Use `vscode.commands.executeCommand('vscode.diff', ...)` with the original and modified URIs.

---

### BUG-5: Global Error Handlers Never Cleaned Up [Medium]

**File:** `src/webview/app.tsx:188-198`

```typescript
window.addEventListener('error', (event) => { ... });
window.addEventListener('unhandledrejection', (event) => { ... });
```

These are registered in `onMount` but never removed in `onCleanup`. If the webview component is unmounted and remounted (which VS Code can do when the sidebar toggles visibility), duplicate handlers will accumulate.

**Fix:** Store handler references and remove them in `onCleanup`.

---

### BUG-6: Operator Precedence Ambiguity in `post()` [Low]

**File:** `src/extension/webview/sidebar-provider.ts:489`

```typescript
if (!this.view || !this.ready && message.type !== 'bootstrap' && message.type !== 'error') return;
```

Due to `&&` binding tighter than `||`, this works correctly but reads ambiguously. A maintenance change could easily break it.

**Fix:** Add explicit parentheses:
```typescript
if (!this.view || (!this.ready && message.type !== 'bootstrap' && message.type !== 'error')) return;
```

---

### BUG-7: Multi-Select Question Option Not Implemented [Low]

**File:** `src/webview/components/question-card.tsx`

The `QuestionItemState` has a `multiple?: boolean` field, but the `QuestionCard` component's click handler always replaces the selection array (`setAnswers(prev => [prev[0] = [label], ...prev]` pattern via setter at line 23). Multi-select mode is declared but not implemented.

---

### BUG-8: `sidebar-header.tsx` Calls `activeSession()` Twice [Low]

**File:** `src/webview/components/sidebar-header.tsx:40`

```typescript
const activeLabel = () => activeSession() ? label(activeSession()!) : 'New Chat';
```

Two `.find()` traversals per evaluation. Minor performance waste.

---

## 5. Dead Code & Redundancy

### DEAD-1: Unused Protocol Message Types [Medium]

**File:** `src/shared/protocol.ts`

Four `HostMessage` variants are defined but **never sent or handled**:

| Type | Lines | Status |
|------|-------|--------|
| `session.patch` | 8-10, 50 | Defined, never sent by host, never handled in webview |
| `permission.requested` | 14-17, 51 | Defined, never sent (host sends session.snapshot instead) |
| `question.requested` | 19-22, 52 | Same as above |
| `theme.changed` | 24-26, 54 | Defined, never sent or handled |

Associated payload types (`SessionPatchPayload`, `PermissionRequestPayload`, `QuestionRequestPayload`, `ThemePayload`) are also unused.

**Recommendation:** Remove these from the protocol or implement them. `session.patch` was likely the planned incremental update strategy before the snapshot-based approach was adopted.

---

### DEAD-2: Unused Functions in `draft-store.ts` [Medium]

**File:** `src/extension/webview/draft-store.ts:5-9, 138-144`

```typescript
function sameModel(a?: DraftModel, b?: DraftModel) { ... }  // Only used by hasSelection
hasSelection(input: DraftSelection) { ... }                   // Never called anywhere
```

`sameModel()` is only called by `hasSelection()`, which is itself never called. Both are dead code.

---

### DEAD-3: Duplicated Editor-Finding Logic [Low]

**File:** `src/extension/vscode/workspace-context.ts:6-9, 21-24`

Both `getActiveFileContext()` and `getSelectionContext()` repeat the same 4-line fallback pattern:

```typescript
let editor = vscode.window.activeTextEditor;
if (!editor && vscode.window.visibleTextEditors.length > 0) {
  editor = vscode.window.visibleTextEditors[0];
}
```

Should be extracted to a private `getEditor()` method.

---

### DEAD-4: Redundant `sortById()` Calls in `serialize()` [Low]

**File:** `src/extension/opencode/session-store.ts:383-385`

```typescript
let rawMessages = sortById(session.messages);
let rawPermissions = sortById(session.permissions);
let rawQuestions = sortById(session.questions);
```

`session.messages`, `session.permissions`, and `session.questions` are already maintained in sorted order by `upsertById()` throughout all event handlers. These re-sorts are O(n log n) redundant work on every serialization.

---

## 6. Code Quality Issues

### CQ-1: Untyped `EventEmitter` Usage [Medium]

**Files:** `process-manager.ts`, `event-stream.ts`, `session-store.ts`

All three classes extend Node's `EventEmitter` without type constraints on event names or payloads:

```typescript
this.emit('statusChange', next);     // What type is 'next'?
this.emit('event', event);           // What type is 'event'?
this.emit('change');                  // No payload
```

Callers use `.on('statusChange', (status) => ...)` with no compile-time guarantee that the event name or callback signature is correct.

**Fix:** Use a typed emitter pattern:
```typescript
interface ProcessManagerEvents {
  statusChange: [ProcessStatus];
}
class ProcessManager extends (EventEmitter as new () => TypedEmitter<ProcessManagerEvents>) { ... }
```

---

### CQ-2: Property Getter with Side Effects [Medium]

**File:** `src/extension/opencode/client.ts:31-44`

```typescript
private get sdk() {
  const next = `${this.proc.baseUrl ?? ''}:${this.proc.password}`;
  if (this.key !== next) {
    this.key = next;
    this.proc.log(`Client reconfigured for ${this.proc.baseUrl ?? 'no-base-url'}`);
    this.sdkValue = this.proc.baseUrl
      ? createOpencodeClient({ ... })
      : undefined;
  }
  return this.sdkValue;
}
```

A property getter that logs and recreates an SDK client instance is surprising. Getters are conventionally side-effect-free. The lazy reconfiguration logic is clever but would be clearer as an explicit `ensureClient()` method.

---

### CQ-3: Magic Number in Client [Medium]

**File:** `src/extension/opencode/client.ts:153`

```typescript
kind: 13,
```

The number `13` has no documented meaning. It's used in the `source` object when sending file attachments to the SDK. Without a comment or enum, it's opaque.

**Fix:** Add a comment: `kind: 13, // LSP SymbolKind.Variable (or whatever it represents)`.

---

### CQ-4: Module-Level Side Effects in `app.tsx` [Low]

**File:** `src/webview/app.tsx:36-57`

```typescript
const vscode = acquireVsCodeApi();
const initial = window.__OPENCODE_INITIAL_STATE__;
const initialPersisted = vscode.getState();
const pendingHostMessages: HostMessage[] = [];
// ...
window.addEventListener('message', ...)
```

These run at import time, making the module impossible to test in isolation or tree-shake.

---

### CQ-5: `as string` Cast on `marked.parse()` [Low]

**File:** `src/webview/components/transcript.tsx:194`

```typescript
const raw = marked.parse(source) as string;
```

`marked.parse()` returns `string | Promise<string>`. The cast suppresses the type error. This works because `marked.setOptions()` is called without `async: true`, but if the library defaults change, this will silently break at runtime.

**Fix:** `const raw = marked.parse(source) as string;` → Use `marked.parseInline(source)` or explicitly configure `{ async: false }`.

---

### CQ-6: `as unknown as SessionState` Cast [Low]

**File:** `src/webview/components/sidebar-header.tsx:75`

```typescript
[{ info: { id: 'empty', ... } } as unknown as SessionState]
```

Double cast to create a synthetic "empty session" for the dropdown. This bypasses all type checking on the fake object. A `<Show when={props.sessions.length === 0}>` wrapper would be cleaner.

---

### CQ-7: JSON Serialize/Deserialize for Dropdown Values [Low]

**File:** `src/webview/components/draft-controls.tsx:108, 131`

```typescript
value: JSON.stringify({ providerID: model.providerID, modelID: model.id }),
// ...
const parsedModel = JSON.parse(value);
```

Using JSON as an encoding for dropdown option values is fragile. A simpler approach would be `"providerID/modelID"` with `.split('/')`.

---

### CQ-8: Mixed Indentation [Low]

**File:** `src/webview/components/composer.tsx:105-107` uses spaces while the rest of the file uses tabs.

---

### CQ-9: Filter Callback Parameter Named `item` for Index [Low]

**File:** `src/webview/app.tsx:370`

```typescript
(chipsState) => chipsState.filter((_, item) => item !== index)
```

The second parameter to `.filter()` is the index, but it's named `item`. Should be `idx` or `i`.

---

## 7. Performance Concerns

### PERF-1: Full Markdown Re-render on Every Update [High]

**File:** `src/webview/components/transcript.tsx:220-245`

Inside `<For each={props.messages}>`, every message runs:
1. `text(message.parts)` — concatenates all parts
2. `renderMarkdown(content)` — `marked.parse()` + `DOMPurify.sanitize()` + `linkifyFileReferences()` (DOMParser + TreeWalker)

When a new SSE event arrives and the session snapshot is updated, **all messages** in the transcript re-render their markdown, not just the new/changed one. For a 50-message conversation, this means 50x full markdown pipeline runs on every streaming delta.

**Fix:** Memoize `renderMarkdown` output per message ID + content hash. Or use SolidJS `createMemo` per message to cache the rendered HTML.

---

### PERF-2: `activeSession()` Called ~7 Times Per Render Without Memoization [Medium]

**File:** `src/webview/app.tsx:280, 304, 312, 328, 338, 348, 350, 377`

```typescript
const activeSession = () => state.sessions.find((session) => session.info.id === state.activeSessionId);
```

This function performs a linear `.find()` over all sessions on every call. It's called 7+ times in the JSX template on every reactive update.

**Fix:** `const activeSession = createMemo(() => ...)`.

---

### PERF-3: No Virtualization for Transcript [Medium]

The transcript renders all messages in the DOM. With long conversations (100+ messages with markdown), DOM size and re-render cost will degrade scroll performance.

---

### PERF-4: Regex Recreation in `linkifyFileReferences` [Low]

**File:** `src/webview/components/transcript.tsx:162`

```typescript
const pattern = new RegExp(FILE_TOKEN_PATTERN.source, 'g');
```

A new regex is created for each text node in each message. Should be created once per `linkifyFileReferences` call and reset with `lastIndex = 0`.

---

### PERF-5: Session Dropdown Scans Messages for Labels [Low]

**File:** `src/webview/components/sidebar-header.tsx`

`label(session)` scans all messages to find the first user message for each session in the dropdown. For many sessions with many messages, this is O(sessions × messages).

---

## 8. Configuration & Build Issues

### CFG-1: Unused `opencode.server.url` Setting [Medium]

**File:** `package.json:57-60`

```json
"opencode.server.url": {
  "type": "string",
  "default": "http://localhost:3000",
  "description": "URL of the OpenCode server"
}
```

This setting is **never read** anywhere in the codebase. The extension always constructs the URL from `http://127.0.0.1:${port}` using the dynamically discovered port. This setting confuses users into thinking they can point the extension at an external server.

**Fix:** Remove the setting or implement external server support.

---

### CFG-2: ESLint Referenced but Not Configured [Medium]

**File:** `package.json:83`

```json
"lint": "eslint src --ext ts,tsx"
```

The `lint` script references ESLint, but there is no `.eslintrc`, `eslint.config.*`, or ESLint dependency in `devDependencies`. Running `npm run lint` will fail.

**Fix:** Either add ESLint + config or remove the script.

---

### CFG-3: `dist/` in `.gitignore` but Committed [Low]

**File:** `.gitignore` includes `dist/`, but `dist/extension.js`, `dist/webview/main.js`, and `dist/webview/main.css` are committed to the repository. The `.gitignore` rule may have been added after the initial commit.

**Fix:** Either remove `dist/` from git tracking (`git rm -r --cached dist/`) or remove the `.gitignore` entry if intentional. Committing build output is unusual but defensible for a `.vsix` extension.

---

### CFG-4: `.vsix` File Committed [Low]

**File:** `opencode-vsc-0.1.1.vsix` (59 KB)

A packaged extension file is committed to the repo. `.gitignore` has `*.vsix` listed, so this was force-added. Committing build artifacts bloats the repo.

---

### CFG-5: `empty directory: media/webview/` [Low]

The `media/webview/` directory exists but is empty. It was likely created for webview-specific assets that were never added.

---

## 9. Documentation Redundancy

The `docs/` directory contains **7 documents** (~4,500 words total). Key observations:

### Overlapping Content

| Document A | Document B | Overlap |
|-----------|-----------|---------|
| `architecture.md` | `protocol-and-state.md` | Both describe the 3-tier runtime, data flow, and state ownership. The "Update Strategy" section in `protocol-and-state.md` duplicates the "Data Flow" section in `architecture.md`. |
| `development-guide.md` | `webview-guide.md` | Both explain how the webview works and how to debug it. |
| `frontend-and-ui-guide.md` | `webview-guide.md` | Both discuss webview constraints and styling approaches. |

### Stale Content

| Document | Issue |
|----------|-------|
| `legacy/IMPLEMENTATION_PLAN.md` | Original specification. Much of it is implemented differently than planned (e.g., SolidJS instead of originally planned approach, different file layout). |
| `postmortem-webview-debugging.md` | References lessons learned that are now reflected in code; the document itself is mainly historical. |

### Recommendation

Consolidate into 3 documents:
1. `architecture.md` — architecture + protocol + state (merge with `protocol-and-state.md`)
2. `development-guide.md` — dev setup + webview constraints (merge with `webview-guide.md`)
3. `ui-guide.md` — front-end styling and UX rules (rename `frontend-and-ui-guide.md`)

Move `IMPLEMENTATION_PLAN.md` and `postmortem-webview-debugging.md` to a `docs/archive/` directory.

---

## 10. Suggested Improvements

### IMP-1: Implement Context Chip Sync Protocol

**Current:** `contextChips` lives in both the webview and extension host independently. When the webview removes a chip, it updates its local state but never tells the host. The host clears all chips only on `sendPrompt`.

**Improvement:** Add a `context.remove` WebviewMessage type so the host tracks the same chip list as the webview. This prevents sending stale attachments if the user removes a chip and then immediately triggers a prompt via a different code path.

---

### IMP-2: Add Exponential Backoff to EventStream Reconnect

**Current:** Fixed 1-second delay (`event-stream.ts:64`).

**Improvement:** Exponential backoff with jitter (1s, 2s, 4s, 8s, max 30s). This prevents thundering-herd reconnections.

---

### IMP-3: Expose the "Remember" Permission Option

**Current:** The `remember` field in `PermissionDecisionPayload` is never set by the UI. All permission replies are `'once'`.

**Improvement:** Add a "Always allow" checkbox or button to the `PermissionCard` component. This is a significant UX improvement for users who trust certain tool permissions.

---

### IMP-4: Implement Actual Diff View for Changed Files

**Current:** Clicking a changed file just opens it.

**Improvement:** Use VS Code's built-in diff API:
```typescript
vscode.commands.executeCommand('vscode.diff', originalUri, modifiedUri, title);
```

---

### IMP-5: Add Error Boundary Per Message

**Current:** A single `ErrorBoundary` wraps the entire app. If one message's markdown rendering fails, the whole UI crashes.

**Improvement:** Wrap each `<For>` item in the transcript with its own `ErrorBoundary`, showing a "Failed to render" fallback per message.

---

### IMP-6: Add Keyboard Shortcut for Send

**Current:** Enter sends, Shift+Enter for newline. No configurable keybinding.

**Improvement:** Register an `opencode.send` command with a keybinding (e.g., `Cmd+Enter`) that can be customized by users.

---

### IMP-7: Add Loading States

**Current:** No loading indicators while sessions are being fetched, hydrated, or while the server is starting.

**Improvement:** Show skeleton screens or spinner during `bootstrap`, `ensureSessionLoaded`, and `loadDraft`.

---

### IMP-8: Consider Test Infrastructure

**Current:** Zero tests. No test framework configured.

**Improvement:** Add at minimum:
- Unit tests for `session-store.ts` (pure logic, easy to test)
- Unit tests for `draft-store.ts` (pure logic)
- Unit tests for `normalizeFileReference` and `isLikelyFileName` in `transcript.tsx`
- Integration test for the webview message protocol

---

### IMP-9: Extract `getEditor()` Helper in WorkspaceContext

**Current:** Both methods in `workspace-context.ts` duplicate the editor-finding fallback.

**Improvement:**
```typescript
private getEditor() {
  return vscode.window.activeTextEditor
    ?? vscode.window.visibleTextEditors[0]
    ?? null;
}
```

---

### IMP-10: Add Accessibility Features

**Current:** No `:focus-visible` styles, no ARIA labels on many interactive elements, no keyboard shortcut for common actions.

**Improvement:** Add focus indicators, ARIA roles for the transcript (e.g., `role="log"`), and screen reader announcements for new messages.

---

## 11. What the Codebase Does Well

1. **Clean Separation of Concerns**: Extension host, webview, and shared types are clearly delineated. The `shared/` layer creates a typed boundary.

2. **Defensive Security**: Path traversal protection with `realpathSync` + `path.relative`, DOMPurify with restrictive config, CSP with nonce-based script execution, `cp.spawn` with arrays.

3. **Robust State Architecture**: The coalesced snapshot approach (50ms debounce) prevents update storms. The `withSuspendedStorePosts` pattern avoids intermediate state flashes during multi-step store mutations.

4. **Error Resilience**: ErrorBoundary, global error/rejection handlers, error banner with auto-dismiss, fallback HTML refresh when the webview doesn't acknowledge messages.

5. **Host-Ack Fallback**: If the webview doesn't send `host.ack`, the extension falls back to a full HTML refresh after 250ms — gracefully handling webview initialization failures.

6. **Well-Typed Protocol**: The `HostMessage` and `WebviewMessage` discriminated unions provide compile-time safety for the postMessage channel.

7. **Efficient SDK Wrapper**: The `Client` class lazily reconfigures the SDK only when connection parameters change, avoiding unnecessary client recreation.

8. **Good Logging**: Every significant action logs to the OutputChannel with consistent format, making debugging much easier.

---

## Summary by File

| File | Issues Found | Severity |
|------|-------------|----------|
| `process-manager.ts` | SEC-1 (weak password) | Medium |
| `html.ts` | SEC-2 (weak nonce) | Medium |
| `app.tsx` | BUG-1, BUG-5, PERF-2, CQ-4, CQ-9 | High-Low |
| `transcript.tsx` | PERF-1, CQ-5 | High-Low |
| `sidebar-provider.ts` | BUG-2, BUG-4, BUG-6 | Medium-Low |
| `session-store.ts` | BUG-3, DEAD-4 | Medium-Low |
| `protocol.ts` | DEAD-1 | Medium |
| `draft-store.ts` | DEAD-2 | Medium |
| `client.ts` | CQ-2, CQ-3 | Medium |
| `sidebar-header.tsx` | BUG-8, CQ-6 | Low |
| `draft-controls.tsx` | CQ-7 | Low |
| `question-card.tsx` | BUG-7 | Low |
| `composer.tsx` | CQ-8 | Low |
| `workspace-context.ts` | DEAD-3 | Low |
| `package.json` | CFG-1, CFG-2 | Medium |
| `main.tsx`, `main.css`, `extension.ts` | Clean | — |
| `icons.tsx`, `dropdown.tsx`, `changed-files.tsx`, `permission-card.tsx` | Clean (minor) | — |

---

*End of review.*
