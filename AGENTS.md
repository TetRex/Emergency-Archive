# Repository Guidelines

## Project Structure & Module Organization
This repository is a static, client-side web app (no build step).

- `index.html`: app shell, page sections, modal markup, and external CDN links.
- `app.js`: core logic (navigation, offline map, POIs, timers, scenarios, chat, library).
- `styles.css`: global styles, layout, component styling, and design tokens in `:root`.
- `.github/assets/`: README screenshots.
- `finland.pmtiles`, `wikipedia_en_100_mini_2026-01.zim`: bundled offline data files (large binaries; change only when intentional).

## Build, Test, and Development Commands
Use a local static server for development:

```bash
python3 -m http.server 8000
```

Open `http://localhost:8000` in a browser.

No package scripts, bundler, or Makefile are configured in this repo. Keep changes runnable directly from static files.

## Coding Style & Naming Conventions
- JavaScript: 2-space indentation, semicolons, `const`/`let`, and double-quoted strings (match existing code).
- Keep logic grouped by feature blocks in `app.js` (navigation, map, timers, chat, etc.).
- CSS: define reusable values as `:root` custom properties; prefer class-based selectors.
- Naming:
  - JS identifiers: `camelCase` (`startLocating`, `renderPoiList`).
  - CSS classes/IDs: `kebab-case` (`chat-model-select`, `poi-sidebar-title`).

## Testing Guidelines
There is no automated test suite currently. Run manual regression checks before submitting:

1. Home/Map/Scenarios/Timers/Chat/Library navigation works.
2. Adding/removing POIs works and persists after refresh.
3. Countdown and stopwatch create, start/pause, reset, and delete correctly.
4. Library browse/search/article view loads from local ZIM file.
5. Chat model list and responses work when local Ollama is running (`http://localhost:11434`).

Document manual test coverage in the PR.

## Commit & Pull Request Guidelines
Git history follows Conventional Commit style (`feat:`, `fix:`, `refactor:`). Continue using:

- `type: short imperative summary`
- Optional scope when useful (`feat(map): ...`)

PRs should include:
- What changed and why.
- Manual test steps/results.
- Screenshots or short recordings for UI changes.
- Linked issue/task when applicable.
