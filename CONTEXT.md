# Sufleur — Project Context & Learned Rules

## Architecture Notes
- Pure browser SPA (React + TypeScript + Vite), English-first (`en-US` default) with multilingual support (`ru-RU`, etc.).
- Feature branch workflow only: never commit directly to `main`.
- Never commit API keys or secrets; BYOK keys (Deepgram / Custom STT) live exclusively in browser `localStorage`.

## Learned Rules
- [2026-11-27] Problem: Importing `pdfjs-dist` eagerly at module top-level throws `ReferenceError: DOMMatrix is not defined` in jsdom test environments and bloats initial bundle → Solution: Always lazy-load `pdfjs-dist` and its worker URL dynamically inside `parsePdfBuffer()`.
- [2026-11-27] Problem: When a speaker stumbles and repeats a phrase that also appears a few words later in the script inside Zone 1's lookahead window, a naive Zone 1-first check skips unread words to the later copy → Solution: Whenever a Zone 1 forward match skips >= 2 unread words AND Zone 2 (behind-cursor repeat buffer) has a strong match (>= 0.75), prioritize Zone 2 repeat-hold over skipping ahead.
- [2026-11-27] Problem: `tsc --noEmit` fails with TS2307 on `.css` and `?url` Vite asset imports when `src/vite-env.d.ts` is absent → Solution: Always include `src/vite-env.d.ts` with `/// <reference types="vite/client" />`.
