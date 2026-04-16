# OpenCode VSC Extension — Full Codebase Review

**Date:** 2026-04-12
**Reviewer:** Claude Opus 4.6
**Scope:** All source files, configuration, build system, and documentation
**Project:** opencode-vsc v0.2.1 — VS Code sidebar extension for the OpenCode AI coding assistant
**Previous Review:** 2026-04-09 (v0.1.1)

---

## Table of Contents

1. [Executive Summary](#1-executive-summary)
2. [Delta From Previous Review](#2-delta-from-previous-review)
3. [Security Vulnerabilities](#3-security-vulnerabilities)
4. [Bugs & Race Conditions](#4-bugs--race-conditions)
5. [Dead Code & Redundancy](#5-dead-code--redundancy)
6. [Code Quality Issues](#6-code-quality-issues)
7. [Performance Concerns](#7-performance-concerns)
8. [Configuration & Build Issues](#8-configuration--build-issues)
9. [Documentation Observations](#9-documentation-observations)
10. [Suggested Improvements](#10-suggested-improvements)
11. [What the Codebase Does Well](#11-what-the-codebase-does-well)

---

## 1. Executive Summary

The codebase is a compact, well-structured VS Code sidebar extension (~4,628 TS/TSX lines + ~1,179 CSS lines across 34 source files). It has grown significantly since v0.1.1 (from ~2,500 to ~4,600 lines), primarily through new features (question cards, todo display, draft controls with search, diff views, thinking/reasoning display, compaction support) and important bug fixes from the previous review.

**TypeScript compiles cleanly** (`tsc --noEmit` produces zero errors).

**Key Finding Summary:**

| Category | Critical | Medium | Low | Informational |
|----------|----------|--------|-----|---------------|
| Security | 0 | 1 | 1 | 2 (fixed since last review) |
| Bugs | 0 | 4 | 3 | — |
| Dead Code | 0 | 2 | 3 | — |
| Code Quality | 0 | 3 | 5 | — |
| Performance | 0 | 3 | 2 | — |
| Config/Build | 0 | 2 | 2 | — |

Overall, the codebase is in notably better shape than v0.1.1. The most critical items from the previous review (weak PRNG-based passwords and nonces) have been fixed, the diff view is now implemented, the scroll behavior has been significantly improved, and several dead code items have been cleaned up.

---

## 2. Delta From Previous Review

### Items Fixed Since 2026-04-09

| Previous ID | Description | Status |
|-------------|-------------|--------|
| SEC-1 | Weak password generation via `Math.random()` | **Fixed** — now uses `crypto.randomBytes(24).toString('base64url')` (`process-manager.ts:138`) |
| SEC-2 | Weak CSP nonce via `Math.random()` | **Fixed** — now uses `crypto.randomBytes(16).toString('base64')` (`html.ts:34-36`) |
| BUG-1 | Broken scroll reactivity via `void state.sessions` | **Fixed** — completely rewritten with `sessionContentSignature()` and `partSignature()` functions that track deep content changes (`app.tsx:110-166, 341-362`) |
| BUG-2 | `loadSession` hardcodes idle status | **Fixed** — now preserves known status from store via `toSdkStatus()` (`sidebar-provider.ts:358`) |
| BUG-3 | `bootstrap()` dead conditional | **Fixed** — simplified to `this.active = null` (`session-store.ts:347`) |
| BUG-4 | `openDiff` was a no-op alias | **Fixed** — full diff implementation with unified patch parsing (`sidebar-provider.ts:533-622`) |
| BUG-5 | Global error handlers not cleaned up | **Fixed** — properly stored as refs and removed in `onCleanup` (`app.tsx:167-176, 323-334`) |
| BUG-6 | Operator precedence ambiguity in `post()` | **Fixed** — now explicit parentheses: `(!this.ready && message.type !== 'bootstrap' && message.type !== 'error')` (`sidebar-provider.ts:557`) |
| BUG-7 | Multi-select question not implemented | **Fixed** — full multi-select implementation in `QuestionCard` with `toggleOption`, `toggleCustom`, custom text input, and proper multi/single answer handling (`question-card.tsx:59-83`) |
| DEAD-3 | Duplicated editor-finding logic | **Fixed** — extracted to `private activeEditor()` method (`workspace-context.ts:5-9`) |
| CQ-3 | Magic number `kind: 13` in client | **Fixed** — the `kind` field and `source` object have been simplified; no magic numbers remain |
| CQ-8 | Mixed indentation in composer | **Partially fixed** — mostly tabs now, but see CQ-NEW-4 below |

### Items Still Present (Modified or Unchanged)

| Previous ID | Description | Current Status |
|-------------|-------------|----------------|
| DEAD-1 | Unused protocol message types | **Still present** — `session.patch`, `permission.requested`, `question.requested`, `theme.changed` remain defined but unused |
| DEAD-2 | Unused `sameModel` + `hasSelection` in draft-store | **Still present** — `sameModel()` and `hasSelection()` are still dead code (`draft-store.ts:5-9, 149-156`) |
| DEAD-4 | Redundant `sortById()` in `serialize()` | **Still present** — arrays are maintained sorted by `upsertById()` then re-sorted in `serialize()` (`session-store.ts:531-533`) |
| CQ-1 | Untyped `EventEmitter` usage | **Still present** — `ProcessManager`, `EventStream`, `SessionStore` all use untyped emitters |
| CQ-2 | Property getter with side effects in `Client.sdk` | **Still present** — same lazy-reconfiguration pattern (`client.ts:51-64`) |
| CQ-5 | `as string` cast on `marked.parse()` | **Still present** — (`transcript.tsx:259`) |
| CQ-6 | Double cast for empty session dropdown | **Still present** — (`sidebar-header.tsx:132`) |
| CQ-7 | JSON serialize/deserialize for dropdown values | **Still present** — (`draft-controls.tsx:237, 260`) |
| CFG-1 | Unused `opencode.server.url` setting | **Still present** — defined in `package.json` but never read in code |
| CFG-2 | ESLint referenced but not configured | **Still present** — no `.eslintrc` or `eslint.config.*` exists, no ESLint devDependency |
| PERF-1 | Full markdown re-render on every update | **Improved** — the scroll signature system limits some churn, but `renderMarkdown()` is still called for every visible message segment on each reactive update (see PERF-NEW-1) |
| PERF-2 | `activeSession()` called multiple times | **Still present** — called ~7 times per render cycle without `createMemo` (`app.tsx:364`) |
| PERF-3 | No transcript virtualization | **Still present** — all messages are in the DOM |
| IMP-8 | No test infrastructure | **Still present** — zero tests |

---

## 3. Security Vulnerabilities

### SEC-NEW-1: No `event.origin` Check on Message Listener [Low]

**File:** `src/webview/app.tsx:57-59`

```typescript
window.addEventListener('message', (event: MessageEvent<HostMessage>) => {
  enqueueHostMessage(event.data);
});
```

Carried forward from previous review. Standard for VS Code webviews (the iframe origin is controlled by VS Code), but deviates from web security best practices.

**Mitigated by:** VS Code's built-in webview sandboxing.

---

### SEC-NEW-2: `openFile` Path Traversal — Symlink TOCTOU Window [Medium]

**File:** `src/extension/webview/sidebar-provider.ts:486-531`

The `openFile` method performs a two-step validation:
1. `fs.realpathSync(resolved)` to resolve symlinks
2. `path.relative(root, target)` to confirm it's inside the session root

However, there's a TOCTOU (time-of-check / time-of-use) window: between the `realpathSync` check and the `showTextDocument` call, a symlink could be swapped. In practice this is extremely unlikely (the attacker would need write access to the workspace during the exact millisecond window), and VS Code's own file opening has the same theoretical issue.

**Risk:** Very low. The existing defense is solid for all practical purposes. Noted for completeness.

---

### Security Positives (Maintained)

- **XSS prevention** in `transcript.tsx:258-264`: DOMPurify with `FORBID_TAGS: ['img']`, `FORBID_ATTR: ['style', 'onerror', 'onload']`, `ALLOWED_URI_REGEXP: /^$/` — excellent.
- **Path traversal protection** in `sidebar-provider.ts:486-531`: `fs.realpathSync` + `path.relative` validation with symlink resolution.
- **Command injection prevention**: `cp.spawn` with argument arrays, never shell strings.
- **Strong CSP policy** in `html.ts:22`: `default-src 'none'` with nonce-gated scripts.
- **Cryptographic password/nonce generation**: Now uses `crypto.randomBytes()`.
- **JSON state embedding**: `<` is escaped to `\u003c` in `html.ts:15` preventing script breakout.

---

## 4. Bugs & Race Conditions

### BUG-NEW-1: Scroll Forced to Bottom When Other Sessions Receive Updates [Medium]

**File:** `src/webview/app.tsx:341-362`

When the session snapshot is updated (any session receives a new message), the `createEffect` fires. It checks if the active session's content signature has changed, but because the snapshot includes ALL sessions, switching the store's `sessions` array can trigger the effect even if only a non-active session was updated. The `sessionContentSignature` filters this partially (it only computes the signature for the active session), but the store mutation `setState('sessions', ...)` itself re-triggers the effect.

**Impact:** When browsing a session that isn't the active one (e.g., scrolling through older messages), the view may jump to the bottom when an unrelated session receives updates.

**Note:** This matches the user-reported bug #1 in `bugs-2026-4-12.md`: "When other sessions have new messages, browsing other sessions also forces scroll to bottom."

---

### BUG-NEW-2: Model Search Dropdown Doesn't Scroll to Top on Open [Medium]

**File:** `src/webview/components/draft-controls.tsx:128-133, 148-155`

The `DraftSelect` component sets `initialScroll` to `'top'` when `searchable` is true:
```typescript
initialScroll={props.searchable ? 'top' : 'active'}
```

And `Dropdown.open()` in `dropdown.tsx:60-68` calls `scrollListToTop()` when `props.initialScroll === 'top'`. However, the search input's `onInput` handler calls `resetListScroll()` which only resets the scroll position when the user types. On initial open (before any typing), the `scrollListToTop()` runs inside a `setTimeout(..., 10)` which races with the dropdown's DOM rendering. If the DOM isn't ready, the scroll target may not exist yet.

**Impact:** The model search dropdown may initially show the list scrolled to the previously active/selected item rather than the top, especially on slower rendering.

**Note:** This matches user-reported bug #2.

---

### BUG-NEW-3: `contextChips` Host/Webview State Can Drift [Medium]

**File:** `src/extension/webview/sidebar-provider.ts:19, 161-179, 302-319`

The `contextChips` array lives in both the host (`SidebarProvider.contextChips`) and the webview (`state.contextChips`). When the webview removes a chip (via `onRemoveChip`), it only updates its own state — the host's `contextChips` array retains the stale chip. The host only clears chips after `sendPrompt` (`sidebar-provider.ts:318`).

However, when `sendPrompt` is called, the `attachments` are taken from the webview's `chips()` (sent in `prompt.send` payload), not from the host's `contextChips`. So the actual prompt is correct.

**Impact:** If the sidebar is re-rendered (e.g., HTML fallback refresh), the old host-side `contextChips` will be re-injected into the webview's initial state, causing removed chips to reappear.

---

### BUG-NEW-4: `bootstrapPromise` Guard Doesn't Prevent Stale Results [Medium]

**File:** `src/extension/webview/sidebar-provider.ts:189-199`

```typescript
private bootstrap() {
  if (this.bootstrapPromise) return this.bootstrapPromise;
  this.bootstrapPromise = this.runBootstrap().finally(() => {
    this.bootstrapPromise = undefined;
  });
  return this.bootstrapPromise;
}
```

If `bootstrap()` is called while a previous bootstrap is still running, it returns the existing promise — which is correct for deduplication. However, if the server's state changed between the two calls (e.g., process restarted), the second caller silently receives the stale result from the first call.

**Impact:** Rare. Would only matter if the server restarts very quickly during bootstrap.

---

### BUG-NEW-5: `archiveSession` Race With Active Session Selection [Low]

**File:** `src/extension/webview/sidebar-provider.ts:278-300`

When archiving the active session:
1. The session is removed from the store
2. A new active session is selected from `this.store.snapshot.sessions[0]`
3. `ensureSessionLoaded` is called for the new active session

But the `archiveSession` API call at line 283 is awaited before updating the store. If the SSE event for the archive arrives before the API call resolves (unlikely but possible), the session could be removed twice.

**Impact:** Very low. The `removeSession` method is idempotent.

---

### BUG-NEW-6: `composerHeight` Resize Logic Reads Min-Height Destructively [Low]

**File:** `src/webview/app.tsx:413-457`

The dragging logic temporarily sets `composerContainer.style.height = '0px'` to read the intrinsic min height, then restores it. This causes a visible flicker if the browser renders a frame between the set and restore. The `transition: none` on line 425 mitigates this, but the pattern is fragile.

---

### BUG-NEW-7: `session-store.ts` `details()` Context Tokens Calculation [Low]

**File:** `src/extension/opencode/session-store.ts:161-166`

```typescript
const contextTokens = assistant.tokens.input
  + assistant.tokens.output
  + assistant.tokens.reasoning
  + assistant.tokens.cache.read
  + assistant.tokens.cache.write;
```

This sums ALL token types as "context tokens." But context tokens typically means the input context window usage, not the sum of all tokens. The field is named `contextCount` and displayed as "Context" in the UI. This may overstate the context usage relative to the model's context limit, making the percentage label misleading.

---

## 5. Dead Code & Redundancy

### DEAD-NEW-1: Unused Protocol Message Types [Medium] (Carried Forward)

**File:** `src/shared/protocol.ts`

Four `HostMessage` variants remain defined but never sent or handled:

| Type | Status |
|------|--------|
| `session.patch` (lines 8-10) | Never sent by host, never handled in webview |
| `permission.requested` (lines 14-17) | Defined, never sent |
| `question.requested` (lines 19-22) | Defined, never sent |
| `theme.changed` (lines 24-26) | Defined, never sent or handled |

Associated payload types (`SessionPatchPayload`, `PermissionRequestPayload`, `QuestionRequestPayload`, `ThemePayload`) are also unused.

---

### DEAD-NEW-2: Unused `sameModel()` and `hasSelection()` in DraftStore [Medium] (Carried Forward)

**File:** `src/extension/webview/draft-store.ts:5-9, 149-156`

`sameModel()` is only called by `hasSelection()`, which is never called from anywhere.

---

### DEAD-NEW-3: Unused `Activity` Icon Component [Low]

**File:** `src/webview/components/icons.tsx:91-106`

The `Activity` icon is exported but never imported or used by any other file.

---

### DEAD-NEW-4: Empty `media/webview/` Directory [Low]

The `media/webview/` directory exists but is empty. Likely created for webview-specific assets that were never added.

---

### DEAD-NEW-5: Redundant `sortById()` in `serialize()` [Low] (Carried Forward)

**File:** `src/extension/opencode/session-store.ts:531-533`

Messages, permissions, and questions are already maintained in sorted order by `upsertById()` throughout all event handlers. The re-sort in `serialize()` is O(n log n) redundant work on every serialization.

---

## 6. Code Quality Issues

### CQ-NEW-1: Untyped `EventEmitter` Usage [Medium] (Carried Forward)

**Files:** `process-manager.ts`, `event-stream.ts`, `session-store.ts`

All three classes extend Node's `EventEmitter` without typed event maps. No compile-time guarantee on event name or callback signature correctness.

---

### CQ-NEW-2: Property Getter with Side Effects [Medium] (Carried Forward)

**File:** `src/extension/opencode/client.ts:51-64`

The `sdk` getter logs, creates SDK client instances, and mutates internal state. Getters should conventionally be side-effect-free. An explicit `ensureClient()` or `getOrCreateClient()` method would be clearer.

---

### CQ-NEW-3: `as unknown as SessionState` Double Cast [Medium]

**File:** `src/webview/components/sidebar-header.tsx:132`

```typescript
[{ info: { id: 'empty' }, messages: [], ... } as unknown as SessionState]
```

This double cast creates a fake "empty session" object that bypasses all type checking. If `SessionState` adds new required fields, this won't fail at compile time. A cleaner approach would be `<Show when={props.sessions.length === 0}>` for the empty-state message, with a separate `<For>` that only runs when there are real sessions.

---

### CQ-NEW-4: Mixed Indentation (Tabs/Spaces) in Composer [Low]

**File:** `src/webview/components/composer.tsx:173-174`

The closing tags use spaces for indentation while the rest of the file uses tabs:
```typescript
      </div>  // spaces
    </div>    // spaces
	);        // tab
```

---

### CQ-NEW-5: `as string` Cast on `marked.parse()` [Low] (Carried Forward)

**File:** `src/webview/components/transcript.tsx:259`

`marked.parse()` returns `string | Promise<string>`. The cast works because async mode is not enabled, but is brittle against library changes.

---

### CQ-NEW-6: JSON Serialize/Deserialize for Model Dropdown Values [Low] (Carried Forward)

**File:** `src/webview/components/draft-controls.tsx:237, 260`

Model selection uses `JSON.stringify/parse` to encode `{providerID, modelID}` as dropdown string values. A simpler `"providerID/modelID"` format with `.split('/')` would be less fragile and more readable.

---

### CQ-NEW-7: `toMessageSummary()` Inconsistent Indentation [Low]

**File:** `src/extension/opencode/session-store.ts:107-121`

The `return` statement for assistant messages has broken indentation — the closing brace is at a different indent level than the opening:
```typescript
  const assistant = message as AssistantMessage;
    return {    // 4 spaces extra
      id: assistant.id,
      // ...
    variant: assistant.variant,
  };            // back to 2 spaces
```

---

### CQ-NEW-8: Filter Callback Parameter Named `item` for Index [Low] (Carried Forward)

**File:** `src/webview/app.tsx:556`

```typescript
(chipsState) => chipsState.filter((_, item) => item !== index)
```

Second parameter to `.filter()` is the index but named `item`. Should be `idx` or `i`.

---

## 7. Performance Concerns

### PERF-NEW-1: Markdown Rendering Not Memoized Per-Segment [Medium]

**File:** `src/webview/components/transcript.tsx:258-267, 281-331`

The `Transcript` component calls `contentSegments(message)` and then `renderMarkdown(segment.content)` for each segment on every render. Since the `Transcript` receives `props.messages` which are replaced wholesale on each snapshot update, SolidJS's `<For>` will re-run the callback for every message on every update (because the array reference changes, even if individual messages haven't changed).

This is improved from v0.1.1 (the scroll logic is better), but the rendering cost is linear in the total number of messages × segments.

**Potential fix:** Key the `<For>` by message ID and memoize `renderMarkdown` output per segment content hash.

---

### PERF-NEW-2: `activeSession()` Not Memoized [Medium] (Carried forward)

**File:** `src/webview/app.tsx:364`

```typescript
const activeSession = () => state.sessions.find(
  (session) => session.info.id === state.activeSessionId
);
```

Called ~7 times in the JSX template. Each call does a linear `.find()`.

**Fix:** `const activeSession = createMemo(() => ...)`.

---

### PERF-NEW-3: `sessionContentSignature` Recomputed Eagerly [Medium]

**File:** `src/webview/app.tsx:135-153, 341-362`

`sessionContentSignature()` is called inside a `createEffect` which fires on every store change. The function accesses deep properties of the session (last message, last part, part signature). While not expensive per call, it runs on every reactive change to `state.sessions` — including changes to non-active sessions.

**Potential fix:** Use `createMemo` to compute the active session first, then a second `createMemo` for the signature, to limit reactivity scope.

---

### PERF-NEW-4: No Transcript Virtualization [Low] (Carried Forward)

All messages render in the DOM. Long conversations will degrade.

---

### PERF-NEW-5: `sidebar-header.tsx` `activeSession()` Called Twice in `activeLabel()` [Low] (Carried Forward)

**File:** `src/webview/components/sidebar-header.tsx:85`

```typescript
const activeLabel = () => activeSession() ? label(activeSession()!) : 'New Chat';
```

Two `.find()` calls for the same result. Should assign to a local variable:
```typescript
const activeLabel = () => { const s = activeSession(); return s ? label(s) : 'New Chat'; };
```

---

## 8. Configuration & Build Issues

### CFG-NEW-1: Unused `opencode.server.url` Setting [Medium] (Carried Forward)

**File:** `package.json:57-60`

This VS Code setting is defined but never read in the code. The extension always constructs the URL from `http://127.0.0.1:${port}`. This confuses users into thinking they can point the extension at an external server.

---

### CFG-NEW-2: ESLint Script Without ESLint [Medium] (Carried Forward)

**File:** `package.json:83`

```json
"lint": "eslint src --ext ts,tsx"
```

No `.eslintrc`, no `eslint.config.*`, no ESLint in `devDependencies`. Running `npm run lint` will fail.

---

### CFG-NEW-3: Multiple `.vsix` Files Committed [Low]

**Files:** `opencode-vsc-0.2.0.vsix` (66 KB), `opencode-vsc-0.2.1.vsix` (67 KB)

Despite `*.vsix` being in `.gitignore`, two `.vsix` files exist in the repo root (force-added or added before the gitignore rule). These are build artifacts that bloat the repository.

---

### CFG-NEW-4: `reference/` Directory in `.gitignore` [Low]

**File:** `.gitignore:9`

The entire `reference/` directory is gitignored. This means review reports (including this one) and architecture diagrams won't be tracked. This is intentional (noted for documentation), but worth confirming — if reference material should persist across clones, remove this entry.

---

## 9. Documentation Observations

### Active Documentation (7 files in `docs/`)

The documentation referenced by `AGENTS.md` is comprehensive for a project of this size:

| Document | Purpose | Current Accuracy |
|----------|---------|-----------------|
| `architecture.md` | Runtime architecture + component roles | **Accurate** — well-maintained, matches current code structure |
| `webview-guide.md` | Webview lifecycle and pitfalls | Accurate |
| `development-guide.md` | Dev workflow | Accurate |
| `frontend-and-ui-guide.md` | UI/layout guidance | Accurate |
| `protocol-and-state.md` | Shared DTOs + state ownership | Mostly accurate — doesn't document new message types (question cards, todos, compaction) |
| `postmortem-webview-debugging.md` | Historical debugging notes | Historical — still useful as reference |
| `legacy/IMPLEMENTATION_PLAN.md` | Original spec | **Stale** — many decisions superseded |

### Overlap

`architecture.md` and `protocol-and-state.md` still overlap in their description of the 3-tier runtime and data flow. This redundancy isn't harmful but adds maintenance burden.

### README.md

The README is minimal and functional. The description "An opencode VS Code extension that works." is honest but could be more informative for potential users. The "heavily vibe-coded" note and model attributions are refreshingly transparent.

---

## 10. Suggested Improvements

### IMP-NEW-1: Memoize Active Session

Convert `activeSession` from a plain function to a `createMemo`:
```typescript
const activeSession = createMemo(() =>
  state.sessions.find(s => s.info.id === state.activeSessionId)
);
```
This eliminates ~7 redundant `.find()` calls per render cycle.

---

### IMP-NEW-2: Scope Scroll Effect to Active Session Only

The scroll `createEffect` in `app.tsx:341-362` should not be triggered by changes to non-active sessions. Restructure to use a `createMemo` for the active session's content signature, then react only to changes in that derived value.

---

### IMP-NEW-3: Add "Remember Always" to Permission Card

The `PermissionCard` currently only offers "Approve" and "Deny". The `replyPermission` method supports a `remember` flag (`client.ts:273`), but the UI never sets it to `true`. Adding an "Always Allow" option would significantly improve UX for trusted tool permissions.

---

### IMP-NEW-4: Add Loading/Connecting Indicator

No visual indicator exists while the server is starting (`connecting` status). Users see a blank sidebar until bootstrap completes. A simple spinner or "Starting OpenCode..." message during the `connecting` state would improve perceived responsiveness.

---

### IMP-NEW-5: Clean Up Dead Protocol Types

Remove `session.patch`, `permission.requested`, `question.requested`, and `theme.changed` from the protocol (and their associated payload types). If these are planned future features, document them as such. Currently they add confusion.

---

### IMP-NEW-6: Add Test Infrastructure

Still zero tests. High-value, low-effort targets:
- **session-store.ts**: Pure state logic, no VS Code dependency. Test event handling, serialization, and revert filtering.
- **draft-store.ts**: Pure normalization/selection logic. Test agent fallback, model picking, variant resolution.
- **transcript.tsx utilities**: `normalizeFileReference()`, `isLikelyFileName()`, `contentSegments()` are pure functions ideal for unit testing.
- **client.ts**: Mock the SDK to test method delegation and error handling.

---

### IMP-NEW-7: Per-Message Error Boundary

A single `ErrorBoundary` wraps the entire app (`app.tsx:472`). If one message's markdown rendering fails (e.g., malformed content), the entire UI crashes. Wrapping each message in its own `ErrorBoundary` with a "Failed to render" fallback would be more resilient.

---

### IMP-NEW-8: Exponential Backoff for EventStream Reconnect

The EventStream uses a fixed 1-second reconnect delay (`event-stream.ts:59-65`). Exponential backoff with jitter (1s, 2s, 4s, 8s, max 30s) would prevent thundering-herd reconnections if the server experiences repeated failures.

---

### IMP-NEW-9: Transcript ARIA Role

The transcript div has no ARIA role. Adding `role="log"` to the `.transcript` container and `aria-live="polite"` would improve screen reader support for streaming responses.

---

### IMP-NEW-10: Address User-Reported Bugs

From `bugs-2026-4-12.md`:

| Bug | Analysis | Related Finding |
|-----|----------|-----------------|
| #1: Other session updates force scroll | Snapshot-level reactivity triggers effect for all sessions | BUG-NEW-1 |
| #2: Model search dropdown scroll position | `initialScroll='top'` races with DOM rendering | BUG-NEW-2 |
| #3: Thinking output not visually distinguished | **Fixed in current code** — thinking sections have distinct `.bubble-thinking` styling with label, border, and background (`transcript.css:47-68`) |
| #4: New session doesn't follow default agent | **Appears fixed** — `DraftStore.restore()` calls `normalize()` which calls `pickAgent()`, which falls back to `this.defaultAgent` from `getDefaultAgent()` API call (`draft-store.ts:79-91, 106-124`). However, this depends on the draft catalog being loaded before session creation — verify the timing. |

---

## 11. What the Codebase Does Well

1. **Significant Improvement Since v0.1.1**: All critical and most medium-severity issues from the previous review have been addressed. The codebase is maturing well.

2. **Clean Three-Tier Architecture**: Extension host, webview, and managed server remain cleanly separated. The webview is a pure rendering surface — no networking, no credentials.

3. **Defensive Security**: Path traversal protection, DOMPurify with strict config, CSP with nonces, `crypto.randomBytes` for secrets, `cp.spawn` with argument arrays.

4. **Robust State Management**: Coalesced snapshot updates (50ms debounce), `withSuspendedStorePosts` for atomic multi-step mutations, host-ack fallback with HTML refresh.

5. **Rich Feature Set**: Question cards with multi-select + custom input, todo display with status indicators, diff views from unified patches, model search with fuzzy/subsequence matching, context chips, reasoning/thinking display, compaction support, revert with message restoration.

6. **Excellent Logging**: Every operation logs to the OutputChannel with consistent format and useful context (session IDs, counts, status transitions).

7. **Well-Typed Protocol**: Discriminated unions for `HostMessage` and `WebviewMessage` provide compile-time safety across the postMessage boundary.

8. **Good VS Code Integration**: Proper webview lifecycle handling, workspace folder detection with fallbacks, relative path resolution, editor selection context gathering.

9. **Clean TypeScript**: Zero compiler errors, strict mode enabled, consistent module resolution.

10. **Sophisticated Draft System**: Model/agent/variant selection with defaults, normalization, and session-based restoration. The fuzzy search in DraftSelect is well-implemented with token matching, subsequence matching, and scoring.

---

## Summary by File

| File | Lines | Issues | Severity |
|------|-------|--------|----------|
| `extension.ts` | 63 | Clean | — |
| `client.ts` | 289 | CQ-NEW-2 | Medium |
| `event-stream.ts` | 78 | IMP-NEW-8 | Low |
| `process-manager.ts` | 218 | Clean | — |
| `session-store.ts` | 558 | DEAD-NEW-5, CQ-NEW-7 | Low |
| `workspace-context.ts` | 49 | Clean | — |
| `draft-store.ts` | 156 | DEAD-NEW-2 | Medium |
| `html.ts` | 37 | Clean | — |
| `sidebar-provider.ts` | 634 | BUG-NEW-3, BUG-NEW-4, SEC-NEW-2 | Medium |
| `models.ts` | 243 | Clean | — |
| `protocol.ts` | 86 | DEAD-NEW-1 | Medium |
| `app.tsx` | 643 | BUG-NEW-1, BUG-NEW-6, PERF-NEW-2, PERF-NEW-3, CQ-NEW-8 | Medium-Low |
| `transcript.tsx` | 331 | PERF-NEW-1, CQ-NEW-5 | Medium-Low |
| `composer.tsx` | 176 | CQ-NEW-4 | Low |
| `sidebar-header.tsx` | 266 | CQ-NEW-3, PERF-NEW-5 | Medium-Low |
| `draft-controls.tsx` | 282 | CQ-NEW-6 | Low |
| `dropdown.tsx` | 136 | Clean | — |
| `question-card.tsx` | 182 | Clean (well-implemented) | — |
| `permission-card.tsx` | 28 | IMP-NEW-3 (missing "remember" option) | Low |
| `changed-files.tsx` | 45 | Clean | — |
| `icons.tsx` | 126 | DEAD-NEW-3 | Low |
| `main.tsx` | 8 | Clean | — |
| CSS (10 files) | 1,179 | Clean — well-organized, uses VS Code theme vars | — |
| `package.json` | 102 | CFG-NEW-1, CFG-NEW-2 | Medium |
| `esbuild.extension.mjs` | 21 | Clean | — |
| `vite.webview.config.ts` | 29 | Clean | — |
| `tsconfig.json` | 20 | Clean | — |

---

*End of review.*
