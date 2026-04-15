# ⚠️ Emergency Archive

This project was completed as part of the course "Browser Programming" at the Savonia University of Applied Sciences.

Emergency Archive is a static, client-side emergency preparedness web app built to work offline first. It bundles map data, scenario guides, and a local Wikipedia archive directly in the repository so the app remains useful without a backend or external content service. The AI chat feature is optional and works when a local [Ollama](https://ollama.com/) instance is running.

---

## Screenshots

| Scenarios | Timers |
|:---:|:---:|
| ![Scenarios](.github/assets/Screenshot%202026-02-26%20at%2015.35.03.png) | ![Timers](.github/assets/Screenshot%202026-02-26%20at%2015.35.57.png) |

| AI Chat | Offline Map |
|:---:|:---:|
| ![AI Chat](.github/assets/Screenshot%202026-02-26%20at%2015.37.07.png) | ![Offline Map](.github/assets/Screenshot%202026-02-26%20at%2015.39.50.png) |

| Home Dashboard |
|:---:|
| ![Home dashboard](.github/assets/Screenshot%202026-02-26%20at%2015.40.09.png) |

---

## Features

### 🏠 Dashboard
A home screen that surfaces active timers and saved points of interest for a quick situation overview.

### 🗺️ Offline Map
- Renders a vector map of **Finland** using the bundled `data/pmtiles/finland.pmtiles` archive.
- Powered by [Leaflet](https://leafletjs.com/) and [Protomaps Leaflet](https://github.com/protomaps/protomaps-leaflet).
- Supports **GPS location tracking** with a pulsing marker and accuracy circle.
- Lets you add **Points of Interest (POIs)** directly from the map with categories for shelter, water, medical, danger, food, and other.
- Saves POIs locally in the browser.

### 📋 Emergency Scenarios
Step-by-step emergency guides are loaded from `data/json/scenarios.json`. The current bundle includes 16 scenarios:

| Scenario | Scenario |
|---|---|
| 🌍 Earthquake | 🌊 Flood |
| 🌪️ Tornado | 🔦 Power Outage |
| 🔥 Forest Fire | 🌊 Tsunami |
| ❄️ Blizzard | ☀️ Heatwave |
| ⛰️ Landslide | 💨 Gas Leak |
| 🏠 Building Fire | 🩺 Medical Emergency |
| ☣️ Hazmat / Chemical Spill | ☢️ Nuclear / Radiation Alert |
| 🔍 Missing Person | 🖥️ Cyber Attack / Grid Failure |

Each guide is shown as an interactive checklist. Tapping a step marks it complete in the current view.

### ⏱️ Timers
- Create **countdown timers** with custom labels.
- Create **stopwatches** that can be started, paused, reset, and deleted.
- Surface active timers on the dashboard.
- Save timer state locally in the browser.

### 🤖 AI Chat
- Connects to a locally running [Ollama](https://ollama.com/) instance at `http://localhost:11434`.
- Auto-detects available models.
- Streams responses in real time with lightweight Markdown rendering.
- Keeps the assistant focused on emergency preparedness, first aid, and survival topics.
- Supports fully offline **English voice input** using a bundled Vosk browser runtime and local speech model.

### 📚 Offline Library
- Opens the bundled `data/zim/wikipedia_en_100_mini_2026-01.zim` archive directly in the browser.
- Supports article browsing, searching, pagination, and reading in an embedded viewer.
- Keeps reference material available locally even without an internet connection.

### 💾 Local Persistence
- POIs and timers are stored in `localStorage`.
- Scenario content is kept in JSON so guides can be expanded without editing the main application logic.

### 🎙️ Offline Voice Input
- Runs speech-to-text locally in the browser using Vosk.
- Uses the bundled `data/models/vosk-model-small-en-us-0.15.tar.gz` model for English transcription.
- Inserts transcripts into the existing AI chat input so users can review or edit before sending to Ollama.

---

## Development

This repository has no build step, package scripts, or backend service. Run it with a local static server:

```bash
python3 -m http.server 8000
```

Then open [http://localhost:8000](http://localhost:8000).

Serving over HTTP is important during development because the app loads bundled JSON, model, and ZIM assets with `fetch()`.

---

## File Structure

```text
├── index.html                   # App shell and page markup
├── app.js                       # App logic for navigation, map, scenarios, timers, chat, and library
├── styles.css                   # Global styles and design tokens
├── README.md                    # Project documentation
├── data/
    ├── json/
    │   └── scenarios.json       # Scenario guide data
    ├── models/
    │   └── vosk-model-small-en-us-0.15.tar.gz  # Offline English speech-to-text model
    ├── pmtiles/
    │   └── finland.pmtiles      # Offline vector map archive
    └── zim/
        └── wikipedia_en_100_mini_2026-01.zim  # Offline Wikipedia archive
└── vendor/
    └── vosk/
        └── vosk.js              # Bundled Vosk browser runtime
```

---

## Data & Privacy

Bundled map tiles, scenario data, and the offline Wikipedia archive are read locally from the repository.

User-created POIs and timers are stored in the browser's `localStorage`. The app does not require a backend service.

The optional AI features stay local as well:
- Voice transcription runs in-browser using the bundled Vosk model.
- Chat responses come from a locally running Ollama server on your own machine.
