# Webview Debugging Postmortem

## Purpose

This document summarizes the main pitfalls and mistakes discovered while stabilizing the OpenCode VS Code sidebar.

It exists so future contributors do not repeat the same failures.

## Main Lessons

1. `WebviewView` lifecycle is easy to get wrong.
2. Host-to-webview messaging is much stricter than it first appears.
3. Large sidebar bootstrap payloads can make a working implementation look broken.
4. Raw SDK objects should not cross the webview boundary.
5. Debugging webviews is harder when the protocol is too clever.

## Mistakes We Made

### 1. Re-rendering `webview.html` as a state update mechanism

We repeatedly rewrote `webview.html` to push new state into the sidebar.

Why this was wrong:

- it remounts the webview
- it resets event listeners and UI-local state
- it creates race conditions around startup and message delivery
- it fights the intended VS Code model for `WebviewView`

Correct direction:

- assign HTML when a specific `WebviewView` is resolved
- use `postMessage` for live updates
- use `getState` and `setState` for persisted webview-local state

### 2. Treating `WebviewView` like a persistent single instance

We used provider-level assumptions such as a one-time render flag.

Why this was wrong:

- VS Code can deallocate and recreate the underlying webview document
- a resolved `WebviewView` instance must be initialized as that specific view
- disposal and visibility transitions matter

Correct direction:

- initialize every resolved view fully
- treat dispose as real teardown
- avoid assuming a single immortal iframe

### 3. Building a custom message bridge too early

We introduced custom relay mechanisms and non-standard event shims.

Why this was wrong:

- it diverged from the official VS Code webview examples
- it increased the number of failure points
- it obscured whether the platform message channel itself was working

Correct direction:

- primary path should stay `webview.postMessage(...)` plus `window.addEventListener('message', ...)`
- only add fallbacks after the standard path is understood and instrumented

### 4. Sending non-trivial state objects without explicit DTO normalization

We passed raw SDK-shaped objects and framework-managed objects across boundaries.

Why this was wrong:

- some objects are not safe to clone or persist
- framework proxies caused failures in `postMessage` and `setState`
- even when types compile, runtime cloning rules are stricter

Correct direction:

- normalize to plain JSON-safe DTOs in `src/shared/models.ts`
- clone draft state and context-chip state before `postMessage` or `setState`
- keep raw SDK types host-side where possible

### 5. Too much work in the bootstrap path

At one point bootstrap loaded full details for all sessions in the workspace.

Why this was wrong:

- a sidebar webview must reach a usable UI quickly
- loading full transcript state for many sessions makes the UI appear frozen
- this also made logs noisy and masked real failures

Correct direction:

- bootstrap with session summaries first
- lazily hydrate the active or selected session
- keep the first render path small

### 6. Posting full session snapshots on every streaming delta

We initially sent a full `session.snapshot` on almost every event, including high-frequency streaming deltas.

Why this was wrong:

- huge amount of serialization work
- unnecessary churn in the webview
- degraded responsiveness during generation

Correct direction:

- coalesce hot-path updates
- keep snapshots cheap
- only refresh expensive state at meaningful boundaries

### 7. Coupling receive-path logic to persistence and logging

The webview message handler also wrote persistent state and emitted extra diagnostics during every update.

Why this was wrong:

- it increased the chance that message handling itself would fail
- it made debugging ambiguous because processing one host event triggered more host communication

Correct direction:

- keep receive-path logic minimal
- UI state updates first
- persistence and diagnostics should be conservative and isolated

### 8. Silent fallback to the extension repo as workspace root

The sidebar sometimes treated the extension repo as the active workspace.

Why this was wrong:

- confusing and dangerous behavior
- wrong sessions, providers, and file context
- made debugging much harder because the logs looked valid while targeting the wrong directory

Correct direction:

- only use real workspace folders, active editor folder, or explicit environment override
- if no workspace root exists, fail clearly

### 9. Trying to solve correctness and feature work at the same time

We added session switching and model/agent controls while the basic webview reliability problem was still unresolved.

Why this was wrong:

- feature work created more state transitions before the underlying transport was trustworthy
- regressions became harder to isolate

Correct direction:

- stabilize the message loop first
- then add UI features on top of a known-good core

## What Finally Helped

1. Moving closer to the official VS Code webview guidance.
2. Reducing host/webview payloads to explicit DTOs.
3. Coalescing snapshot updates instead of pushing on every event.
4. Loading session details lazily instead of eagerly.
5. Adding host acknowledgements and a compatibility fallback for environments where host-to-webview updates behaved unexpectedly.

## Rules Going Forward

1. Do not reintroduce HTML rewrites as the primary state transport.
2. Do not send raw SDK or framework proxy objects to the webview.
3. Keep sidebar bootstrap cheap.
4. Coalesce streaming updates.
5. Keep the standard VS Code webview messaging pattern as the primary path.
6. When behavior is unclear, instrument one layer at a time.
