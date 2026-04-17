# Frontend And UI Guide

## Purpose

This document is for frontend engineers and UI designers working on the OpenCode sidebar.

It describes the UI constraints of a VS Code sidebar, how this repo structures webview UI work, and how to make changes without breaking responsiveness or the host/webview contract.

## Product Context

This is not a full browser app.

This is a narrow, persistent, sidebar-first assistant inside VS Code.

That changes design priorities:

1. density matters more than decoration
2. responsiveness matters more than large transitions
3. readability in dark themes is mandatory
4. state changes must remain legible in a narrow column
5. host/webview boundaries are real product constraints, not implementation details

## UI Principles

### 1. Design for the sidebar first

Assume the most common width is narrow.

UI should still work when the sidebar is around 300-420px wide.

This means:

- avoid multi-column dependency for core tasks
- avoid long labels that cannot truncate cleanly
- prefer vertical stacking over cramped horizontal controls
- keep primary actions reachable without scrolling through decorative chrome

### 2. Keep the main action loop obvious

The primary flow is:

1. pick or create a session
2. read transcript
3. adjust draft options if needed
4. send prompt
5. review output and changed files

The layout should keep that loop easy to understand at a glance.

### 3. Prefer calm, structured surfaces

This extension lives inside another complex product.

The UI should feel native to VS Code rather than competing with it.

Prefer:

- clean grouping
- clear spacing
- strong text hierarchy
- restrained accent use

Avoid:

- oversized cards
- heavy shadows
- large ornamental gradients
- motion that distracts from coding flow

### 4. Use VS Code theme tokens first

The webview must respect user theme choices.

Use VS Code CSS variables whenever possible, such as:

- `--vscode-sideBar-background`
- `--vscode-foreground`
- `--vscode-panel-border`
- `--vscode-button-background`
- `--vscode-button-foreground`
- `--vscode-input-background`
- `--vscode-input-foreground`

Do not hardcode colors unless there is no suitable token and the case is narrow.

## Current Webview Structure

Main files:

- `src/webview/main.tsx` — entry point, mounts the Solid app into `#root`
- `src/webview/app.tsx` — root `App` component, host message handling, state management
- `src/webview/main.css` — CSS entry point, imports all style modules
- `src/webview/styles/*.css` — focused style files split by UI area
- `src/webview/components/sidebar-header.tsx` — session dropdown, status row, connection indicator
- `src/webview/components/draft-controls.tsx` — agent, model, and variant selector dropdowns with fuzzy search
- `src/webview/components/dropdown.tsx` — generic dropdown primitive with keyboard navigation and overlay dismiss
- `src/webview/components/transcript.tsx` — message bubbles, markdown rendering, file link detection, reasoning blocks
- `src/webview/components/composer.tsx` — text input, attachment chips, todo panel, send/interrupt controls
- `src/webview/components/changed-files.tsx` — collapsible changed files list with additions/deletions counts
- `src/webview/components/permission-card.tsx` — permission request card with approve/deny actions
- `src/webview/components/question-card.tsx` — question card with single/multi-select options and custom text input
- `src/webview/components/icons.tsx` — inline SVG icon components: `ChevronDown`, `Plus`, `Paperclip`, `Square`, `Send`, `Archive`

General layout:

- header at top (session dropdown + status row)
- error banner if needed (dismissible, auto-dismiss after 5 seconds)
- scrollable body with transcript, permission/question cards, and changed files
- drag-resizable composer container anchored at bottom of the column (height persisted across reloads)
- revert confirmation modal (triggered from transcript message actions)
- archive confirmation modal (triggered from session dropdown)

## Responsibilities Split

### Webview responsibilities

- rendering sessions, transcript, controls, cards, and composer
- lightweight UI-local interactions
- keeping persisted local view state small

### Host responsibilities

- fetching session and provider data
- managing OpenCode server interaction
- normalizing DTOs
- opening files or diffs via VS Code APIs

Do not move server communication into the webview for convenience.

## UX Guidelines By Area

### Header

The header should stay compact.

It should answer:

- is the assistant connected?
- how do I start a new chat?

Do not overload the header with secondary controls.

### Session list

The session list should be scannable and compact.

Prefer:

- clear active state
- short, stable row labels
- lightweight metadata like recency or running status

Avoid:

- dense per-row action menus unless clearly needed
- large thumbnails or decorative icons

### Draft controls

Model, variant, and agent selectors are secondary configuration.

They should be available, but not dominate the UI.

Prefer:

- compact selects
- predictable ordering
- clear disabled state when a variant is not available

### Transcript

Transcript readability is the most important content concern.

Prefer:

- distinct user and assistant surfaces
- clear treatment for reasoning or thinking blocks (collapsible)
- good whitespace for long responses
- pre-wrapped text for generated content
- clear affordance for file links, revert, and changed files
- file references detected and linkified as clickable buttons (posting `file.open` to the host)
- per-message actions: "Raw" (view raw JSON) and "Revert to here" (user messages only)
- user message attachment links shown below the role label when not already mentioned inline

Avoid:

- overly small text
- excessive nesting
- noisy per-part chrome unless it adds real value

### Composer

The composer is the primary action control.

It should:

- always feel easy to find
- work well with keyboard input (Enter to send, Shift+Enter for newline)
- make attachments visible but not dominant (chip list above the textarea)
- show a collapsible todo panel with progress summary and active task preview when tasks exist
- keep todo summary, draft controls, and interrupt state legible in narrow widths
- keep send behavior predictable (send button when idle, stop/interrupt button when busy)
- support drag-resizable height with persisted state across sidebar reloads

The composer toolbar currently contains:

- attach dropdown (Active File and Selection options via the generic `Dropdown` component)
- draft controls slot (model, agent, variant selectors)
- send or interrupt button

### Permission and question cards

These are interruption surfaces.

They should be clear and actionable, not visually heavy.

Make the decision obvious:

- what is being asked
- what can the user do
- what the default next action is

### Changed files

This section should help users understand impact quickly.

Prefer:

- filename first
- simple additions/deletions summary
- clear open file and open diff affordances

## Layout And Responsiveness Rules

1. Core UI must work at narrow sidebar widths.
2. Horizontal layouts should degrade gracefully.
3. Use truncation for long labels.
4. Avoid overflow that hides primary actions.
5. Keep the composer usable on both small and large widths.

The current CSS already uses a mobile-like collapse for draft controls below a narrow width. Continue that approach.

## Styling Rules

1. Keep `src/webview/main.css` as the entry point and split real styles into focused files under `src/webview/styles`.
2. Group selectors by app shell, shared primitives, or a specific UI area instead of growing one large stylesheet.
3. Reuse existing class patterns instead of inventing many one-off styles.
4. Keep visual language consistent across cards, buttons, and list items.
5. Use spacing and typography before adding more borders or color.

Current style file organization:

- `styles/base.css` — reset, body, `#root`
- `styles/app-shell.css` — `.app-shell` flex layout, modals, error banner, resizer, composer container
- `styles/shared.css` — button variants, link buttons, utility classes
- `styles/dropdown.css` — generic dropdown overlay, menu, list items
- `styles/sidebar-header.css` — header layout, session dropdown, status row, connection dots
- `styles/transcript.css` — message bubbles, markdown body, thinking blocks, file links, actions
- `styles/cards.css` — permission and question card layout
- `styles/changed-files.css` — collapsible file list, addition/deletion counts
- `styles/composer.css` — textarea, toolbar, chips, todo panel
- `styles/draft-controls.css` — inline draft selectors, searchable dropdown

## Accessibility Expectations

At minimum:

1. controls must remain keyboard reachable
2. text contrast must work in light and dark themes
3. status should not depend on color alone
4. labels for settings-like controls should stay visible

## Performance Rules For Frontend Work

Frontend changes must respect the runtime constraints of the sidebar.

Do not assume browser-app scale.

Important rules:

1. avoid rendering large unnecessary trees
2. keep bootstrap content small
3. do not add expensive derived UI work in hot streaming paths without need
4. avoid turning every server event into a visually noisy update

## How To Work On UI Safely

Recommended process:

1. identify whether the change is purely presentational or needs protocol changes
2. if protocol changes are needed, update shared DTOs first
3. make the smallest UI change that proves the behavior
4. run `npm run compile`
5. run `npm run build`
6. verify in the extension host with real sidebar width and real session state

## Common Traps

1. designing like this is a full-width web app
2. using non-token colors that break in dark or high-contrast themes
3. adding controls before confirming where the data and ownership belong
4. making bootstrap heavier to support richer first paint
5. solving a host-state issue by adding more webview-side complexity

## Design Review Checklist

Before landing a non-trivial UI change, check:

1. does it still work in a narrow sidebar?
2. does it still look correct in dark and light themes?
3. is the primary prompt flow still obvious?
4. does it preserve the host/webview responsibility split?
5. does it avoid adding more startup or streaming churn?
