# Sufleur — Project Context & Learned Rules

## Architecture Notes
- Pure browser SPA (React + TypeScript + Vite), English-first (`en-US` default) with multilingual support (`ru-RU`, etc.).
- Feature branch workflow only: never commit directly to `main`.
- Never commit API keys or secrets; BYOK keys (Deepgram / Custom STT) live exclusively in browser `localStorage`.

## Learned Rules
- [2026-11-27] Problem: Importing `pdfjs-dist` eagerly at module top-level throws `ReferenceError: DOMMatrix is not defined` in jsdom test environments and bloats initial bundle → Solution: Always lazy-load `pdfjs-dist` and its worker URL dynamically inside `parsePdfBuffer()`.
- [2026-11-27] Problem: When a speaker stumbles and repeats a phrase that also appears a few words later in the script inside Zone 1's lookahead window, a naive Zone 1-first check skips unread words to the later copy → Solution: Whenever a Zone 1 forward match skips >= 2 unread words AND Zone 2 (behind-cursor repeat buffer) has a strong match (>= 0.75), prioritize Zone 2 repeat-hold over skipping ahead.
- [2026-11-27] Problem: `tsc --noEmit` fails with TS2307 on `.css` and `?url` Vite asset imports when `src/vite-env.d.ts` is absent → Solution: Always include `src/vite-env.d.ts` with `/// <reference types="vite/client" />`.
- [2026-11-27] Problem: Positioning `.floating-hud` with `left: 50%; transform: translateX(-50%)` shrinks its available shrink-to-fit width to 50% of the container and clips right-edge HUD buttons on mobile and narrow split panes → Solution: Anchor `.floating-hud` with `left: max(8px, env(safe-area-inset-left)); right: max(8px, env(safe-area-inset-right)); pointer-events: none;` (and `pointer-events: auto` on children), and wrap `.hud-bar` neatly on `<= 640px`.
- [2026-11-27] Problem: Zone 3 global jump sorted candidates by raw text score with distance only as a 0.02 tie-breaker and committed on 3-word matches, causing a mid-script stumble to teleport back to a similar phrase at the start of the script → Solution: Apply continuous proximity decay from `cursorUnit` (stronger decay for far-backward jumps) and enforce distance-aware evidence gates (far-backward jumps >45 units require >=5 distinctive words or sustained confirmation).
