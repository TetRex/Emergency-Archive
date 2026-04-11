# ⚠️ Emergency Archive
This project was completed as part of the course "Browser Programming" at the Savonia University of Applied Sciences.
A fully offline-capable emergency preparedness web app. It works without any internet connection — maps, AI chat, voice input, and all scenario guides run entirely on-device.

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
| ![Home dashboard](.github/assets//Screenshot%202026-02-26%20at%2015.40.09.png) |

## Features

### 🏠 Dashboard
A home screen summarising active timers and saved points of interest for a quick situation overview.

### 🗺️ Offline Map
- Renders a vector map of **Finland** using a locally bundled `finland.pmtiles` file — zero network tile requests.
- Powered by [Leaflet](https://leafletjs.com/) and [Protomaps Leaflet](https://github.com/protomaps/protomaps-leaflet).
- **GPS location tracking** — shows your position with a pulsing dot and accuracy circle.
- **Points of Interest (POI)** — tap anywhere on the map to pin a location. Categories: Shelter, Water, Medical, Danger Zone, Food, Other. POIs persist across sessions.

### 📋 Emergency Scenarios
Step-by-step interactive guides for nine emergency types:

| Scenario | Scenario |
|---|---|
| 🌍 Earthquake | 🌊 Flood |
| 🌪️ Tornado | 🔦 Power Outage |
| 🔥 Forest Fire | 🌊 Tsunami |
| ❄️ Blizzard | ☀️ Heatwave |
| ⛰️ Landslide | |

Each guide is presented as a numbered checklist — tap a step to mark it complete.

### ⏱️ Timers
- **Countdown timers** — set hours, minutes, seconds with a custom label.
- **Stopwatches** — start, pause, reset, and delete at any time.
- Active timer counts are surfaced on the Home dashboard.

### 🤖 AI Chat
- Connects to a locally running [Ollama](https://ollama.com/) instance (`http://localhost:11434`).
- Auto-detects all available models via the Ollama API.
- Streams responses in real time with lightweight Markdown rendering.
- Responses are scoped to emergency preparedness, first aid, and survival topics.

---

## File Structure

```
├── index.html          # App shell & all page markup
├── app.js              # All application logic (map, POIs, timers, chat, voice)
├── styles.css          # Styles
└── finland.pmtiles     # Bundled offline vector map for Finland
```

---

## Data & Privacy

All data — map tiles, POIs, timers, AI conversations, and voice recordings — stays on your device. Nothing is transmitted to external servers (the Whisper model is downloaded from Hugging Face on first use; Ollama runs locally).
