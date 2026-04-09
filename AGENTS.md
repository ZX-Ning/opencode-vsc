# AGENTS

This repository is a VS Code extension for OpenCode with a sidebar-first `WebviewView` UI.

Read these documents before making non-trivial changes:

- `docs/architecture.md`
  Current runtime architecture, boundaries, and major components.
- `docs/webview-guide.md`
  Webview lifecycle, messaging rules, and pitfalls specific to VS Code `WebviewView`.
- `docs/development-guide.md`
  Local development workflow, debug flow, and verification steps.
- `docs/frontend-and-ui-guide.md`
  UI, layout, and frontend implementation guidance for the sidebar experience.
- `docs/protocol-and-state.md`
  Shared DTOs, host/webview protocol, and state ownership.
- `docs/postmortem-webview-debugging.md`
  Pitfalls and mistakes discovered during the long webview debugging process.

General guidance:

- Keep all OpenCode networking in the extension host.
- Treat the webview as a rendering surface plus UI-local state only.
- Prefer typed DTOs over raw SDK objects across the host/webview boundary.
- Prefer small, validated changes over broad refactors.
- Follow the official VS Code webview guidance when touching lifecycle or messaging.
- Verify with both `npm run compile` and `npm run build` after meaningful changes.
