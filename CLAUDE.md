# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

**Emergency Archive** is a fully offline-capable Progressive Web App (PWA) for emergency preparedness. It is a vanilla JavaScript single-page app with no build system — no npm, no bundler, no framework.

## Running the App

Serve the static files locally (no build step required):

```bash
python3 -m http.server 8000
# or
npx http-server
```

Then open `http://localhost:8000` in a browser.

**For AI chat**, a local Ollama instance must be running at `http://localhost:11434`:

```bash
ollama serve
# Pull a model if needed:
ollama pull llama3.2
```

## Architecture

The app is structured as a single-page application with 5 pages switched via a bottom nav bar. All logic lives in three files:

- **[index.html](index.html)** — App shell and all page markup (5 pages: Home, Map, Scenarios, Timers, Chat)
- **[app.js](app.js)** — All application logic (~972 lines), organized into feature modules
- **[styles.css](styles.css)** — Mobile-first styling
- **[sw.js](sw.js)** — Service Worker; cache-first for app shell, skips PMTiles and Hugging Face models
- **[whisper-worker.js](whisper-worker.js)** — Web Worker for offline speech-to-text via Xenova Whisper tiny

### app.js Module Structure

| Section | Responsibility |
|---|---|
| State & persistence | `emergencyHub` object in localStorage; POIs + timers |
| Navigation | Page switching via `.page` element visibility |
| Map | Leaflet + Protomaps offline vector tiles (`finland.pmtiles`) centered on Finland |
| POIs | 6 categories (Shelter, Water, Medical, Danger, Food, Other); stored with lat/lng |
| Timers | Countdown and stopwatch; 100ms tick loop; pause/reset/delete |
| Home dashboard | Aggregates active timers and POIs; refreshes every 500ms |
| Scenarios | 9 hardcoded emergency types with step-by-step guides; steps toggle completed state |
| AI Chat | Streams from Ollama `/api/chat`; detects models via `/api/tags`; emergency-scoped system prompt |
| Speech | Web Worker transcribes audio at 16kHz mono; Whisper model cached in IndexedDB |

### Offline Strategy

- App shell (HTML/CSS/JS/Leaflet) is cached by the Service Worker on first load
- Map tiles come from the bundled `finland.pmtiles` file (1.5 GB)
- Whisper model (~75 MB) is downloaded on first voice use and stored in IndexedDB
- Ollama runs locally; no network needed for AI chat after setup

### Data Persistence

- **localStorage key**: `"emergencyHub"` — stores POIs, timers, and incrementing IDs
- **IndexedDB** — Whisper model cache (managed by Xenova Transformers library)

## External Dependencies (CDN, no install needed)

- Leaflet 1.9.4
- Protomaps Leaflet 5.0.0
- Xenova Transformers (Whisper, loaded in Web Worker from Hugging Face on first use)
