/* ============================================
   Emergency Hub – Application Logic
   ============================================ */

(() => {
  "use strict";

  // ──────────── State ────────────
  const state = {
    pois: [],          // { id, name, category, lat, lng }
    timers: [],        // { id, label, type:'countdown'|'stopwatch', totalMs, remainingMs, running, intervalId }
    nextPoiId: 1,
    nextTimerId: 1,
  };

  // ──────────── DOM refs ────────────
  const $ = (s, ctx = document) => ctx.querySelector(s);
  const $$ = (s, ctx = document) => [...ctx.querySelectorAll(s)];

  const pages        = $$(".page");
  const navBtns      = $$("#bottom-nav .nav-btn");

  // Home
  const homeTimersList = $("#home-timers-list");
  const homePoiList    = $("#home-poi-list");
  const homeLibraryList = $("#home-library-list");
  const homeStatTimers = $("#home-stat-timers");
  const homeStatPoi = $("#home-stat-poi");
  const homeStatLibrary = $("#home-stat-library");

  // Map
  const poiModal     = $("#poi-modal");
  const poiNameInput = $("#poi-name");
  const poiCatSelect = $("#poi-category");
  const poiSaveBtn   = $("#poi-save-btn");
  const poiCancelBtn = $("#poi-cancel-btn");
  const poiListEl    = $("#poi-list");

  // Timers
  const addCountdownBtn  = $("#add-countdown-btn");
  const addStopwatchBtn  = $("#add-stopwatch-btn");
  const timersGrid       = $("#timers-grid");
  const timersEmpty      = $("#timers-empty");
  const countdownModal   = $("#countdown-modal");
  const cdLabel          = $("#cd-label");
  const cdHours          = $("#cd-hours");
  const cdMinutes        = $("#cd-minutes");
  const cdSeconds        = $("#cd-seconds");
  const cdSaveBtn        = $("#cd-save-btn");
  const cdCancelBtn      = $("#cd-cancel-btn");

  // ──────────── Navigation ────────────
  function navigateTo(pageId) {
    if (pageId !== "page-chat" && (voiceRecording || voiceFinalizing)) {
      stopVoiceInput(true);
    }
    pages.forEach(p => p.classList.toggle("active", p.id === pageId));
    navBtns.forEach(b => b.classList.toggle("active", b.dataset.target === pageId));
    if (pageId === "page-map") {
      requestAnimationFrame(() => requestAnimationFrame(() => map.invalidateSize()));
    }
    if (pageId === "page-home") refreshHome();
    if (pageId === "page-chat") chatInit();
    if (pageId === "page-library") initLibrary();
  }

  navBtns.forEach(btn => btn.addEventListener("click", () => navigateTo(btn.dataset.target)));

  // Card link buttons
  $$("[data-nav]").forEach(btn =>
    btn.addEventListener("click", () => navigateTo(btn.dataset.nav))
  );

  // ──────────── Map (Protomaps – local Finland PMTiles) ────────────
  const map = L.map("map", {
    zoomControl: false,
    zoomAnimation: true,
    fadeAnimation: true,
    markerZoomAnimation: true,
    zoomSnap: 1,              // integer zoom levels only – protomaps canvas can't render fractional
    zoomDelta: 1,
    wheelPxPerZoomLevel: 120, // higher = more scroll needed per level → feels smoother
    minZoom: 5,
    maxZoom: 15,
  }).setView([60.1699, 24.9384], 10);
  L.control.zoom({ position: "topright" }).addTo(map);

  // Uses the locally bundled PMTiles archive – zero network requests needed.
  const pmLayer = protomapsL.leafletLayer({
    url: "./data/pmtiles/finland.pmtiles",
    flavor: "dark",
    lang: "en",
  }).addTo(map);

  window.addEventListener("resize", () => {
    if (document.querySelector("#page-map.active")) {
      requestAnimationFrame(() => map.invalidateSize());
    }
  });

  // ──────────── User Location ────────────
  let locationMarker = null;
  let locationCircle = null;
  let watchId = null;
  let locating = false;
  const locateBtn = $("#locate-btn");

  function setLocationMarker(lat, lng, accuracy) {
    if (locationMarker) {
      locationMarker.setLatLng([lat, lng]);
      locationCircle.setLatLng([lat, lng]).setRadius(accuracy);
    } else {
      locationCircle = L.circle([lat, lng], {
        radius: accuracy,
        color: "#4a9eff",
        fillColor: "#4a9eff",
        fillOpacity: 0.12,
        weight: 1,
      }).addTo(map);

      const icon = L.divIcon({
        className: "",
        html: `<div class="user-dot"><div class="user-dot-pulse"></div></div>`,
        iconSize: [20, 20],
        iconAnchor: [10, 10],
      });
      locationMarker = L.marker([lat, lng], { icon, zIndexOffset: 1000 })
        .bindPopup("📍 You are here")
        .addTo(map);
    }
  }

  function startLocating() {
    if (!navigator.geolocation) {
      alert("Geolocation is not supported by your browser.");
      return;
    }
    locating = true;
    locateBtn.classList.add("locate-active");
    locateBtn.title = "Stop tracking";

    navigator.geolocation.getCurrentPosition(
      (pos) => {
        const { latitude: lat, longitude: lng, accuracy } = pos.coords;
        setLocationMarker(lat, lng, accuracy);
        map.setView([lat, lng], Math.max(map.getZoom(), 13));
      },
      () => { stopLocating(); alert("Could not get your location."); },
      { enableHighAccuracy: true, timeout: 10000 }
    );

    watchId = navigator.geolocation.watchPosition(
      (pos) => {
        const { latitude: lat, longitude: lng, accuracy } = pos.coords;
        setLocationMarker(lat, lng, accuracy);
      },
      () => {},
      { enableHighAccuracy: true }
    );
  }

  function stopLocating() {
    if (watchId !== null) { navigator.geolocation.clearWatch(watchId); watchId = null; }
    locating = false;
    locateBtn.classList.remove("locate-active");
    locateBtn.title = "Show my location";
  }

  locateBtn.addEventListener("click", () => {
    if (locating) {
      stopLocating();
    } else {
      startLocating();
    }
  });

  const categoryIcons = {
    shelter: "🏠", water: "💧", medical: "⚕", danger: "⚠️", food: "🍖", other: "📌"
  };

  let pendingLatLng = null;
  const markers = {};   // poiId → L.marker

  map.on("click", (e) => {
    pendingLatLng = e.latlng;
    poiNameInput.value = "";
    poiCatSelect.value = "shelter";
    poiModal.classList.remove("hidden");
    setTimeout(() => poiNameInput.focus(), 100);
  });

  poiCancelBtn.addEventListener("click", () => {
    poiModal.classList.add("hidden");
    pendingLatLng = null;
  });

  poiSaveBtn.addEventListener("click", () => {
    if (!pendingLatLng) return;
    const name = poiNameInput.value.trim() || "Unnamed";
    const category = poiCatSelect.value;
    const poi = {
      id: state.nextPoiId++,
      name,
      category,
      lat: pendingLatLng.lat,
      lng: pendingLatLng.lng,
    };
    state.pois.push(poi);
    addPoiMarker(poi);
    renderPoiList();
    poiModal.classList.add("hidden");
    pendingLatLng = null;
    saveState();
  });

  function addPoiMarker(poi) {
    const icon = L.divIcon({
      className: "poi-div-icon",
      html: `<span style="font-size:1.6rem">${categoryIcons[poi.category] || "📌"}</span>`,
      iconSize: [32, 32],
      iconAnchor: [16, 16],
    });
    const marker = L.marker([poi.lat, poi.lng], { icon })
      .addTo(map)
      .bindPopup(`<b>${poi.name}</b><br>${poi.category}`);
    markers[poi.id] = marker;
  }

  function renderPoiList() {
    const emptyState = $("#poi-empty-state");
    const countBadge = $("#poi-count-badge");
    // Remove existing poi items (but keep the empty state element)
    poiListEl.querySelectorAll("li:not(#poi-empty-state)").forEach(el => el.remove());

    if (state.pois.length === 0) {
      if (emptyState) emptyState.style.display = "";
      if (countBadge) countBadge.textContent = "0";
      return;
    }
    if (emptyState) emptyState.style.display = "none";
    if (countBadge) countBadge.textContent = state.pois.length;

    state.pois.forEach(poi => {
      const li = document.createElement("li");
      li.className = `poi-cat-${poi.category}`;
      li.innerHTML = `
        <span class="poi-icon-pill">${categoryIcons[poi.category] || "📌"}</span>
        <div class="poi-info">
          <div class="poi-name">${poi.name}</div>
          <div class="poi-cat">${poi.category} &middot; ${poi.lat.toFixed(4)}, ${poi.lng.toFixed(4)}</div>
        </div>
        <button class="poi-remove-btn" data-id="${poi.id}" title="Remove">&#10005;</button>
      `;
      poiListEl.appendChild(li);
    });
    poiListEl.querySelectorAll(".poi-remove-btn").forEach(btn =>
      btn.addEventListener("click", () => removePoi(Number(btn.dataset.id)))
    );
  }

  function removePoi(id) {
    state.pois = state.pois.filter(p => p.id !== id);
    if (markers[id]) { map.removeLayer(markers[id]); delete markers[id]; }
    renderPoiList();
    saveState();
  }

  // ──────────── Timers ────────────
  addCountdownBtn.addEventListener("click", () => {
    cdLabel.value = "";
    cdHours.value = 0;
    cdMinutes.value = 5;
    cdSeconds.value = 0;
    countdownModal.classList.remove("hidden");
    setTimeout(() => cdLabel.focus(), 100);
  });

  cdCancelBtn.addEventListener("click", () => countdownModal.classList.add("hidden"));

  cdSaveBtn.addEventListener("click", () => {
    const h = Math.max(0, parseInt(cdHours.value) || 0);
    const m = Math.max(0, parseInt(cdMinutes.value) || 0);
    const s = Math.max(0, parseInt(cdSeconds.value) || 0);
    const totalMs = (h * 3600 + m * 60 + s) * 1000;
    if (totalMs <= 0) return;
    const timer = {
      id: state.nextTimerId++,
      label: cdLabel.value.trim() || "Countdown",
      type: "countdown",
      totalMs,
      remainingMs: totalMs,
      running: false,
      intervalId: null,
    };
    state.timers.push(timer);
    countdownModal.classList.add("hidden");
    renderTimers();
    startTimer(timer.id);
    saveState();
  });

  addStopwatchBtn.addEventListener("click", () => {
    const timer = {
      id: state.nextTimerId++,
      label: "Stopwatch",
      type: "stopwatch",
      totalMs: 0,
      remainingMs: 0,
      running: false,
      intervalId: null,
    };
    state.timers.push(timer);
    renderTimers();
    startTimer(timer.id);
    saveState();
  });

  function formatMs(ms) {
    const totalSec = Math.max(0, Math.floor(ms / 1000));
    const h = Math.floor(totalSec / 3600);
    const m = Math.floor((totalSec % 3600) / 60);
    const s = totalSec % 60;
    return `${String(h).padStart(2,"0")}:${String(m).padStart(2,"0")}:${String(s).padStart(2,"0")}`;
  }

  function renderTimers() {
    // Remove old cards
    timersGrid.querySelectorAll(".timer-card").forEach(c => c.remove());
    timersEmpty.style.display = state.timers.length ? "none" : "block";

    state.timers.forEach(t => {
      const card = document.createElement("div");
      card.className = "timer-card" + (t.type === "countdown" && t.remainingMs <= 0 ? " expired" : "");
      card.id = `timer-${t.id}`;
      const display = t.type === "countdown" ? formatMs(t.remainingMs) : formatMs(t.remainingMs);
      card.innerHTML = `
        <div class="tc-label">
          <span>${t.label}</span>
          <span class="tc-type">${t.type === "countdown" ? "⏳ Countdown" : "⏱ Stopwatch"}</span>
        </div>
        <div class="tc-display">${display}</div>
        <div class="tc-actions">
          ${t.running
            ? `<button class="tc-pause" data-id="${t.id}">Pause</button>`
            : `<button class="tc-start" data-id="${t.id}">${t.type === "countdown" && t.remainingMs <= 0 ? "Restart" : "Start"}</button>`}
          <button class="tc-reset" data-id="${t.id}">Reset</button>
          <button class="tc-delete" data-id="${t.id}">Delete</button>
        </div>
      `;
      timersGrid.appendChild(card);
    });

    // Wire buttons
    timersGrid.querySelectorAll(".tc-start").forEach(b =>
      b.addEventListener("click", () => startTimer(Number(b.dataset.id)))
    );
    timersGrid.querySelectorAll(".tc-pause").forEach(b =>
      b.addEventListener("click", () => pauseTimer(Number(b.dataset.id)))
    );
    timersGrid.querySelectorAll(".tc-reset").forEach(b =>
      b.addEventListener("click", () => resetTimer(Number(b.dataset.id)))
    );
    timersGrid.querySelectorAll(".tc-delete").forEach(b =>
      b.addEventListener("click", () => deleteTimer(Number(b.dataset.id)))
    );
  }

  function getTimer(id) { return state.timers.find(t => t.id === id); }

  function tickTimer(timer) {
    if (timer.type === "countdown") {
      timer.remainingMs -= 100;
      if (timer.remainingMs <= 0) {
        timer.remainingMs = 0;
        pauseTimer(timer.id);
        // Visual flash
        const card = $(`#timer-${timer.id}`);
        if (card) card.classList.add("expired");
      }
    } else {
      timer.remainingMs += 100;
    }
    updateTimerDisplay(timer);
  }

  function updateTimerDisplay(timer) {
    const card = $(`#timer-${timer.id}`);
    if (!card) return;
    const display = card.querySelector(".tc-display");
    if (display) display.textContent = formatMs(timer.remainingMs);
  }

  function startTimer(id) {
    const t = getTimer(id);
    if (!t) return;
    if (t.type === "countdown" && t.remainingMs <= 0) t.remainingMs = t.totalMs; // restart
    t.running = true;
    clearInterval(t.intervalId);
    t.intervalId = setInterval(() => tickTimer(t), 100);
    renderTimers();
    saveState();
  }

  function pauseTimer(id) {
    const t = getTimer(id);
    if (!t) return;
    t.running = false;
    clearInterval(t.intervalId);
    t.intervalId = null;
    renderTimers();
    saveState();
  }

  function resetTimer(id) {
    const t = getTimer(id);
    if (!t) return;
    clearInterval(t.intervalId);
    t.intervalId = null;
    t.running = false;
    t.remainingMs = t.type === "countdown" ? t.totalMs : 0;
    renderTimers();
    saveState();
  }

  function deleteTimer(id) {
    const t = getTimer(id);
    if (t) clearInterval(t.intervalId);
    state.timers = state.timers.filter(t => t.id !== id);
    renderTimers();
    saveState();
  }

  // ──────────── Home dashboard ────────────
  function getStoredZimBookmarks() {
    try {
      const raw = localStorage.getItem("emergencyHubZimBookmarks");
      const data = raw ? JSON.parse(raw) : [];
      return Array.isArray(data) ? data : [];
    } catch {
      return [];
    }
  }

  function refreshHome() {
    // Timers
    const activeTimers = state.timers.filter(t => t.running);
    const bookmarks = getStoredZimBookmarks();
    homeStatTimers.textContent = String(activeTimers.length);
    homeStatPoi.textContent = String(state.pois.length);
    homeStatLibrary.textContent = String(bookmarks.length);

    if (activeTimers.length === 0) {
      homeTimersList.innerHTML = `<p class="empty-msg">No active timers</p>`;
    } else {
      homeTimersList.innerHTML = "";
      activeTimers.forEach(t => {
        const div = document.createElement("div");
        div.className = "home-item";
        div.innerHTML = `<span class="hi-label">${t.label}</span><span class="hi-extra">${formatMs(t.remainingMs)}</span>`;
        homeTimersList.appendChild(div);
      });
    }

    // POIs
    if (state.pois.length === 0) {
      homePoiList.innerHTML = `<p class="empty-msg">No points of interest</p>`;
    } else {
      homePoiList.innerHTML = "";
      state.pois.forEach(p => {
        const div = document.createElement("div");
        div.className = "home-item";
        div.innerHTML = `<span class="hi-label">${categoryIcons[p.category] || "📌"} ${p.name}</span><span class="hi-extra">${p.category}</span>`;
        homePoiList.appendChild(div);
      });
    }

    // Library bookmarks
    if (bookmarks.length === 0) {
      homeLibraryList.innerHTML = `<p class="empty-msg">No bookmarked articles</p>`;
    } else {
      homeLibraryList.innerHTML = "";
      bookmarks.slice(0, 6).forEach(bookmark => {
        const button = document.createElement("button");
        button.className = "home-item home-item-button";
        button.type = "button";
        button.innerHTML = `<span class="hi-label">&#128218; ${bookmark.title}</span><span class="hi-extra">Open</span>`;
        button.addEventListener("click", () => openLibraryFromBookmark(bookmark));
        homeLibraryList.appendChild(button);
      });
    }
  }

  // Keep home timers updating when visible
  setInterval(() => {
    if (document.querySelector("#page-home.active")) refreshHome();
  }, 500);

  // ──────────── Persistence (localStorage) ────────────
  function saveState() {
    const data = {
      pois: state.pois,
      timers: state.timers.map(t => ({
        id: t.id,
        label: t.label,
        type: t.type,
        totalMs: t.totalMs,
        remainingMs: t.remainingMs,
        running: t.running,
      })),
      nextPoiId: state.nextPoiId,
      nextTimerId: state.nextTimerId,
    };
    try { localStorage.setItem("emergencyHub", JSON.stringify(data)); } catch {}
  }

  function loadState() {
    try {
      const raw = localStorage.getItem("emergencyHub");
      if (!raw) return;
      const data = JSON.parse(raw);
      state.nextPoiId = data.nextPoiId || 1;
      state.nextTimerId = data.nextTimerId || 1;

      // POIs
      (data.pois || []).forEach(poi => {
        state.pois.push(poi);
        addPoiMarker(poi);
      });
      renderPoiList();

      // Timers
      (data.timers || []).forEach(t => {
        t.intervalId = null;
        state.timers.push(t);
        if (t.running) {
          t.running = false; // will be started below
          setTimeout(() => startTimer(t.id), 0);
        }
      });
      renderTimers();
    } catch {}
  }

  // ──────────── Emergency Scenarios ────────────
  const SCENARIOS_URL = "./data/json/scenarios.json";
  let scenarios = [];

  const scenarioCategoriesEl = $("#scenario-categories");
  const scenarioDetail = $("#scenario-detail");
  const scenarioDetailContent = $("#scenario-detail-content");
  const scenarioBackBtn = $("#scenario-back-btn");

  function renderScenarioEmptyState(message) {
    scenarioCategoriesEl.innerHTML = `<p class="empty-msg">${message}</p>`;
  }

  function renderScenarioCards() {
    scenarioCategoriesEl.innerHTML = "";
    if (scenarios.length === 0) {
      renderScenarioEmptyState("No scenarios available.");
      return;
    }

    scenarios.forEach((sc) => {
      const card = document.createElement("div");
      card.className = "scenario-card";
      card.style.borderColor = sc.color;
      card.innerHTML = `
        <span class="sc-icon" style="background:${sc.color}">${sc.icon}</span>
        <span class="sc-title">${sc.title}</span>
        <span class="sc-count">${sc.steps.length} steps</span>
      `;
      card.addEventListener("click", () => showScenario(sc));
      scenarioCategoriesEl.appendChild(card);
    });
  }

  async function loadScenarios() {
    renderScenarioEmptyState("Loading scenarios...");

    try {
      const res = await fetch(SCENARIOS_URL);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);

      const data = await res.json();
      if (!Array.isArray(data)) throw new Error("Scenario data must be an array.");

      scenarios = data;
      renderScenarioCards();
    } catch (err) {
      scenarios = [];
      renderScenarioEmptyState("Could not load scenarios.");
      console.error("Failed to load scenarios:", err);
    }
  }

  function showScenario(sc) {
    scenarioCategoriesEl.classList.add("hidden");
    scenarioDetail.classList.remove("hidden");
    scenarioDetailContent.innerHTML = `
      <h2 style="margin-bottom:12px">${sc.icon} ${sc.title}</h2>
      <ol class="scenario-steps">
        ${sc.steps
          .map(
            (s, i) => `
          <li class="scenario-step" data-index="${i}">
            <div class="ss-header">
              <span class="ss-num" style="background:${sc.color}">${i + 1}</span>
              <span class="ss-title">${s.title}</span>
            </div>
            <p class="ss-desc">${s.desc}</p>
          </li>`
          )
          .join("")}
      </ol>
    `;

    // Make steps checkable
    scenarioDetailContent.querySelectorAll(".scenario-step").forEach((li) => {
      li.addEventListener("click", () => li.classList.toggle("step-done"));
    });
  }

  scenarioBackBtn.addEventListener("click", () => {
    scenarioCategoriesEl.classList.remove("hidden");
    scenarioDetail.classList.add("hidden");
  });

  // ──────────── AI Chat (Ollama) ────────────
  const OLLAMA_BASE = "http://localhost:11434";
  const VOSK_MODEL_URL = "./data/models/vosk-model-small-en-us-0.15.tar.gz";
  const AudioContextClass = window.AudioContext || window.webkitAudioContext;
  const SYSTEM_PROMPT = `You are an expert emergency preparedness assistant embedded in an offline mobile app called Emergency Hub.
Provide clear, concise, actionable advice on first aid, survival, evacuation, natural disasters, and emergency procedures.
Keep answers brief (2-5 sentences unless a step-by-step list is needed). Never recommend illegal actions.`;

  const chatModelSelect = $("#chat-model-select");
  const chatStatusEl    = $("#chat-status");
  const chatMessagesEl  = $("#chat-messages");
  const chatInput       = $("#chat-input");
  const chatSendBtn     = $("#chat-send-btn");
  const chatClearBtn    = $("#chat-clear-btn");
  const chatVoiceBtn    = $("#chat-voice-btn");
  const chatVoiceStatus = $("#chat-voice-status");

  let chatHistory = [];
  let chatReady   = false;
  let chatInited  = false;
  let chatSending = false;

  const voiceSupported = !!(window.Vosk && navigator.mediaDevices?.getUserMedia && AudioContextClass);
  let voiceModelPromise = null;
  let voiceModel = null;
  let voiceRecognizer = null;
  let voiceAudioContext = null;
  let voiceStream = null;
  let voiceSourceNode = null;
  let voiceProcessorNode = null;
  let voiceMuteNode = null;
  let voiceRecording = false;
  let voiceFinalizing = false;
  let voicePreparing = false;
  let voiceDraftPrefix = "";
  let voiceTranscriptSegments = [];
  let voicePartialTranscript = "";

  async function chatInit() {
    if (chatInited) return;
    chatInited = true;
    try {
      const res = await fetch(`${OLLAMA_BASE}/api/tags`, { signal: AbortSignal.timeout(3000) });
      const data = await res.json();
      const models = (data.models || []).map(m => m.name);
      if (models.length === 0) throw new Error("no models");
      chatModelSelect.innerHTML = models.map(m => `<option value="${m}">${m}</option>`).join("");
      chatStatusEl.textContent = "● Online";
      chatStatusEl.className = "chat-status chat-status--online";
      chatReady = true;
    } catch {
      chatModelSelect.innerHTML = `<option value="">Ollama not running</option>`;
      chatStatusEl.textContent = "● Offline";
      chatStatusEl.className = "chat-status chat-status--offline";
    }
  }

  function resizeChatInput() {
    chatInput.style.height = "auto";
    chatInput.style.height = chatInput.scrollHeight + "px";
  }

  function setChatVoiceStatus(message, tone = "info") {
    if (!message) {
      chatVoiceStatus.textContent = "";
      chatVoiceStatus.className = "chat-voice-status hidden";
      return;
    }
    chatVoiceStatus.textContent = message;
    chatVoiceStatus.className = `chat-voice-status chat-voice-status--${tone}`;
  }

  function syncChatControls() {
    chatSendBtn.disabled = chatSending || voiceRecording || voiceFinalizing;
    chatVoiceBtn.disabled = !voiceSupported || chatSending || voiceFinalizing || voicePreparing;
    chatVoiceBtn.classList.toggle("is-recording", voiceRecording);
    chatVoiceBtn.title = voiceRecording ? "Stop voice input" : "Start voice input";
    chatVoiceBtn.setAttribute("aria-pressed", voiceRecording ? "true" : "false");
  }

  function getVoiceTranscriptText() {
    return [...voiceTranscriptSegments, voicePartialTranscript]
      .filter(Boolean)
      .join(" ")
      .trim();
  }

  function buildVoiceDraft() {
    const spoken = getVoiceTranscriptText();

    if (!voiceDraftPrefix) return spoken;
    if (!spoken) return voiceDraftPrefix;

    return `${voiceDraftPrefix}${/\s$/.test(voiceDraftPrefix) ? "" : " "}${spoken}`;
  }

  function updateVoiceDraft() {
    chatInput.value = buildVoiceDraft();
    resizeChatInput();
  }

  function cleanupVoiceResources() {
    if (voiceProcessorNode) {
      voiceProcessorNode.onaudioprocess = null;
      try { voiceProcessorNode.disconnect(); } catch {}
      voiceProcessorNode = null;
    }
    if (voiceSourceNode) {
      try { voiceSourceNode.disconnect(); } catch {}
      voiceSourceNode = null;
    }
    if (voiceMuteNode) {
      try { voiceMuteNode.disconnect(); } catch {}
      voiceMuteNode = null;
    }
    if (voiceStream) {
      voiceStream.getTracks().forEach(track => track.stop());
      voiceStream = null;
    }
    if (voiceAudioContext) {
      voiceAudioContext.close().catch(() => {});
      voiceAudioContext = null;
    }
    if (voiceRecognizer) {
      try { voiceRecognizer.remove(); } catch {}
      voiceRecognizer = null;
    }
    voiceRecording = false;
    voiceFinalizing = false;
    voicePreparing = false;
    syncChatControls();
  }

  async function loadVoiceModel() {
    if (voiceModel) return voiceModel;
    if (!voiceSupported) throw new Error("Voice input is not supported in this browser.");

    if (!voiceModelPromise) {
      setChatVoiceStatus("Loading offline voice model...", "info");
      voiceModelPromise = window.Vosk.createModel(VOSK_MODEL_URL)
        .then((model) => {
          voiceModel = model;
          model.on("error", (message) => {
            console.error("Vosk model error:", message.error);
            setChatVoiceStatus("Offline voice model error.", "error");
          });
          return model;
        })
        .catch((err) => {
          voiceModelPromise = null;
          throw err;
        });
    }

    const model = await voiceModelPromise;
    setChatVoiceStatus("Offline voice ready.", "success");
    return model;
  }

  async function startVoiceInput() {
    if (!voiceSupported || voiceRecording || voiceFinalizing || voicePreparing) return;

    try {
      voicePreparing = true;
      syncChatControls();
      const model = await loadVoiceModel();

      setChatVoiceStatus("Requesting microphone access...", "info");
      voiceStream = await navigator.mediaDevices.getUserMedia({
        video: false,
        audio: {
          channelCount: 1,
          sampleRate: 16000,
          echoCancellation: true,
          noiseSuppression: true,
        },
      });

      voiceAudioContext = new AudioContextClass({ sampleRate: 16000 });
      await voiceAudioContext.resume();

      voiceRecognizer = new model.KaldiRecognizer(16000);
      voiceDraftPrefix = chatInput.value.trim();
      voiceTranscriptSegments = [];
      voicePartialTranscript = "";

      voiceRecognizer.on("result", (message) => {
        const text = message.result?.text?.trim();
        if (text) voiceTranscriptSegments.push(text);
        voicePartialTranscript = "";
        updateVoiceDraft();
      });

      voiceRecognizer.on("partialresult", (message) => {
        voicePartialTranscript = message.result?.partial?.trim() || "";
        updateVoiceDraft();
      });

      voiceRecognizer.on("error", (message) => {
        console.error("Vosk recognizer error:", message.error);
        setChatVoiceStatus("Voice recognition failed.", "error");
        stopVoiceInput(true);
      });

      voiceSourceNode = voiceAudioContext.createMediaStreamSource(voiceStream);
      voiceProcessorNode = voiceAudioContext.createScriptProcessor(4096, 1, 1);
      voiceMuteNode = voiceAudioContext.createGain();
      voiceMuteNode.gain.value = 0;

      voiceProcessorNode.onaudioprocess = (event) => {
        if (!voiceRecognizer) return;
        try {
          voiceRecognizer.acceptWaveform(event.inputBuffer);
        } catch (err) {
          console.error("Voice waveform processing failed:", err);
          setChatVoiceStatus("Voice processing failed.", "error");
          stopVoiceInput(true);
        }
      };

      voiceSourceNode.connect(voiceProcessorNode);
      voiceProcessorNode.connect(voiceMuteNode);
      voiceMuteNode.connect(voiceAudioContext.destination);

      voiceRecording = true;
      voicePreparing = false;
      syncChatControls();
      setChatVoiceStatus("Listening... tap the mic again to stop.", "recording");
    } catch (err) {
      cleanupVoiceResources();
      if (err?.name === "NotAllowedError") {
        setChatVoiceStatus("Microphone access was denied.", "error");
      } else {
        setChatVoiceStatus("Could not start offline voice input.", "error");
      }
      console.error("Voice input start failed:", err);
    }
  }

  async function stopVoiceInput(abort = false) {
    if ((!voiceRecording && !voiceFinalizing) || !voiceRecognizer) {
      cleanupVoiceResources();
      return;
    }

    voiceRecording = false;
    voiceFinalizing = !abort;
    syncChatControls();

    if (abort) {
      cleanupVoiceResources();
      setChatVoiceStatus("Voice input stopped.", "info");
      return;
    }

    setChatVoiceStatus("Finishing transcription...", "info");
    try {
      voiceRecognizer.retrieveFinalResult();
    } catch {}

    await new Promise(resolve => setTimeout(resolve, 250));

    const spokenTranscript = getVoiceTranscriptText();
    cleanupVoiceResources();
    setChatVoiceStatus(
      spokenTranscript ? "Transcript added to the message." : "No speech was detected.",
      spokenTranscript ? "success" : "info"
    );
    chatInput.focus();
  }

  // Lightweight markdown → HTML (handles bold, italic, headings, bullets, code)
  function mdToHtml(md) {
    const esc = s => s.replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;");
    const lines = md.split("\n");
    const out = [];
    let inUl = false, inOl = false;
    for (const raw of lines) {
      let line = raw;
      // headings → bold line
      line = line.replace(/^#{1,6}\s+(.+)$/, (_, t) => `<strong>${esc(t)}</strong>`);
      // unordered list item
      const ulMatch = line.match(/^(\s*)[*\-]\s+(.+)$/);
      // ordered list item
      const olMatch = !ulMatch && line.match(/^\s*\d+\.\s+(.+)$/);
      if (ulMatch) {
        if (!inUl) { if (inOl) { out.push("</ol>"); inOl=false; } out.push("<ul>"); inUl=true; }
        let item = ulMatch[2];
        item = item.replace(/\*\*(.+?)\*\*/g, (_,t)=>`<strong>${esc(t)}</strong>`);
        item = item.replace(/\*(.+?)\*/g, (_,t)=>`<em>${esc(t)}</em>`);
        item = item.replace(/`(.+?)`/g, (_,t)=>`<code>${esc(t)}</code>`);
        out.push(`<li>${item}</li>`);
        continue;
      } else if (inUl) { out.push("</ul>"); inUl=false; }
      if (olMatch) {
        if (!inOl) { if (inUl) { out.push("</ul>"); inUl=false; } out.push("<ol>"); inOl=true; }
        let item = olMatch[1];
        item = item.replace(/\*\*(.+?)\*\*/g, (_,t)=>`<strong>${esc(t)}</strong>`);
        item = item.replace(/\*(.+?)\*/g, (_,t)=>`<em>${esc(t)}</em>`);
        item = item.replace(/`(.+?)`/g, (_,t)=>`<code>${esc(t)}</code>`);
        out.push(`<li>${item}</li>`);
        continue;
      } else if (inOl) { out.push("</ol>"); inOl=false; }
      // inline formatting on regular lines
      line = line.replace(/\*\*(.+?)\*\*/g, (_,t)=>`<strong>${esc(t)}</strong>`);
      line = line.replace(/\*(.+?)\*/g, (_,t)=>`<em>${esc(t)}</em>`);
      line = line.replace(/_(.+?)_/g, (_,t)=>`<em>${esc(t)}</em>`);
      line = line.replace(/`(.+?)`/g, (_,t)=>`<code>${esc(t)}</code>`);
      // blank line → paragraph break, otherwise line break
      out.push(line.trim() === "" ? "<br>" : line + "<br>");
    }
    if (inUl) out.push("</ul>");
    if (inOl) out.push("</ol>");
    return out.join("");
  }

  function chatAppend(role, text, typing = false) {
    const div = document.createElement("div");
    div.className = `chat-bubble chat-bubble--${role}${typing ? " is-typing" : ""}`;
    if (typing || role === "user") {
      div.textContent = text;
    } else {
      div.innerHTML = mdToHtml(text);
    }
    chatMessagesEl.appendChild(div);
    chatMessagesEl.scrollTop = chatMessagesEl.scrollHeight;
    return div;
  }

  async function chatSend() {
    const text = chatInput.value.trim();
    if (!text || !chatReady || voiceRecording || voiceFinalizing) return;
    const model = chatModelSelect.value;
    if (!model) return;

    chatInput.value = "";
    resizeChatInput();
    chatSending = true;
    syncChatControls();

    chatHistory.push({ role: "user", content: text });
    chatAppend("user", text);

    const thinkingBubble = chatAppend("assistant", "Thinking…", true);
    let fullReply = "";

    try {
      const res = await fetch(`${OLLAMA_BASE}/api/chat`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          model,
          stream: true,
          messages: [
            { role: "system", content: SYSTEM_PROMPT },
            ...chatHistory,
          ],
        }),
      });

      if (!res.ok) throw new Error(`HTTP ${res.status}`);

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      thinkingBubble.classList.remove("is-typing");
      thinkingBubble.textContent = "";

      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        const lines = decoder.decode(value, { stream: true }).split("\n").filter(Boolean);
        for (const line of lines) {
          try {
            const chunk = JSON.parse(line);
            const token = chunk?.message?.content ?? "";
            fullReply += token;
            thinkingBubble.innerHTML = mdToHtml(fullReply);
            chatMessagesEl.scrollTop = chatMessagesEl.scrollHeight;
          } catch { /* partial JSON line – skip */ }
        }
      }
    } catch (err) {
      thinkingBubble.textContent = `Error: ${err.message}. Is Ollama running?`;
      thinkingBubble.classList.add("is-typing");
    }

    if (fullReply) chatHistory.push({ role: "assistant", content: fullReply });
    chatSending = false;
    syncChatControls();
    chatInput.focus();
  }

  chatClearBtn.addEventListener("click", () => {
    if (voiceRecording || voiceFinalizing) stopVoiceInput(true);
    chatHistory = [];
    chatMessagesEl.innerHTML = `<div class="chat-bubble chat-bubble--assistant"><p>Chat cleared. How can I help you?</p></div>`;
    chatInput.value = "";
    resizeChatInput();
    setChatVoiceStatus("", "info");
  });

  chatSendBtn.addEventListener("click", chatSend);
  chatVoiceBtn.addEventListener("click", () => {
    if (!voiceSupported) {
      setChatVoiceStatus("Voice input is not supported in this browser.", "error");
      return;
    }
    if (voiceRecording) {
      stopVoiceInput();
    } else {
      startVoiceInput();
    }
  });

  chatInput.addEventListener("keydown", e => {
    if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); chatSend(); }
  });
  chatInput.addEventListener("input", () => {
    resizeChatInput();
  });

  if (!voiceSupported) {
    setChatVoiceStatus("Voice input is not supported in this browser.", "error");
  }
  syncChatControls();

  // ──────────── ZIM Library ────────────

  // Reads a local HTTP file via Range requests — same interface as File.slice()
  class HttpFile {
    constructor(url, name) {
      this.url  = url;
      this.name = name || url.split('/').pop();
    }
    slice(start, end) {
      const { url } = this;
      return {
        arrayBuffer: async () => {
          const res = await fetch(url, { headers: { Range: `bytes=${start}-${end - 1}` } });
          if (!res.ok && res.status !== 206) throw new Error(`HTTP ${res.status} reading ZIM`);
          return res.arrayBuffer();
        },
      };
    }
  }

  const BUNDLED_ZIM = {
    url:  "./data/zim/wikipedia_en_100_mini_2026-01.zim",
    name: 'Wikipedia EN — Jan 2026',
  };

  class ZimReader {
    constructor(file) {
      this.file = file;
      this.header = null;
      this.mimeTypes = [];
      this.urlPtrView = null;
      this.titlePtrs  = null;
    }

    async init(onProgress) {
      onProgress('Reading header…');
      await this._readHeader();
      await this._readMimeTypes();
      onProgress(`Loading index (${this.header.articleCount.toLocaleString()} articles)…`);
      await this._loadPtrLists();
    }

    async _readRange(offset, length) {
      return new DataView(await this.file.slice(offset, offset + length).arrayBuffer());
    }

    _u64(dv, offset) {
      const lo = dv.getUint32(offset, true);
      const hi = dv.getUint32(offset + 4, true);
      return hi * 4294967296 + lo;
    }

    async _readHeader() {
      const dv = await this._readRange(0, 80);
      if (dv.getUint32(0, true) !== 0x044D495A)
        throw new Error('Not a valid ZIM file (wrong magic number)');
      // Detect UINT64_MAX (0xFFFFFFFFFFFFFFFF) for titlePtrPos without float precision loss
      const titleLo = dv.getUint32(40, true);
      const titleHi = dv.getUint32(44, true);
      this.header = {
        articleCount:  dv.getUint32(24, true),
        clusterCount:  dv.getUint32(28, true),
        urlPtrPos:     this._u64(dv, 32),
        titlePtrPos:   titleHi * 4294967296 + titleLo,
        hasTitleIndex: !(titleLo === 0xFFFFFFFF && titleHi === 0xFFFFFFFF),
        clusterPtrPos: this._u64(dv, 48),
        mimeListPos:   this._u64(dv, 56),
        mainPage:      dv.getUint32(64, true),
        checksumPos:   this._u64(dv, 72),
      };
    }

    async _readMimeTypes() {
      const dv = await this._readRange(this.header.mimeListPos, 4096);
      const bytes = new Uint8Array(dv.buffer);
      let pos = 0;
      while (pos < bytes.length) {
        let end = pos;
        while (end < bytes.length && bytes[end] !== 0) end++;
        if (end === pos) break;
        this.mimeTypes.push(new TextDecoder().decode(bytes.slice(pos, end)));
        pos = end + 1;
      }
    }

    async _loadPtrLists() {
      const n = this.header.articleCount;
      const urlBuf = await this.file.slice(
        this.header.urlPtrPos, this.header.urlPtrPos + n * 8
      ).arrayBuffer();
      this.urlPtrView = new DataView(urlBuf);

      // ZIM v6 sets titlePtrPos = UINT64_MAX — no title index available
      if (this.header.hasTitleIndex) {
        const titleBuf = await this.file.slice(
          this.header.titlePtrPos, this.header.titlePtrPos + n * 4
        ).arrayBuffer();
        this.titlePtrs = new Uint32Array(titleBuf);
      }
    }

    _urlOffset(idx) {
      const lo = this.urlPtrView.getUint32(idx * 8, true);
      const hi = this.urlPtrView.getUint32(idx * 8 + 4, true);
      return hi * 4294967296 + lo;
    }

    async readDirEntry(urlIdx) {
      const offset = this._urlOffset(urlIdx);
      const dv = await this._readRange(offset, 1024);
      const bytes = new Uint8Array(dv.buffer);

      const mimeType = dv.getUint16(0, true);
      const namespace = String.fromCharCode(dv.getUint8(3));
      const isRedirect = mimeType === 0xffff;

      let clusterNum, blobNum, redirectIndex, strStart;
      if (isRedirect) {
        redirectIndex = dv.getUint32(8, true);
        strStart = 12;
      } else {
        clusterNum = dv.getUint32(8, true);
        blobNum    = dv.getUint32(12, true);
        strStart   = 16;
      }

      const readStr = (from) => {
        let end = from;
        while (end < bytes.length && bytes[end] !== 0) end++;
        return [new TextDecoder().decode(bytes.slice(from, end)), end + 1];
      };
      const [url, titleAt] = readStr(strStart);
      const [rawTitle]     = readStr(titleAt);

      return {
        urlIdx, namespace, mimeType,
        mime: this.mimeTypes[mimeType] ?? 'application/octet-stream',
        clusterNum, blobNum, redirectIndex,
        url, title: rawTitle || url, isRedirect,
      };
    }

    async getEntryByTitleIdx(i) {
      return this.readDirEntry(this.titlePtrs[i]);
    }

    // Binary search on URL-sorted list to find entry by namespace+url
    async findByUrl(namespace, url) {
      const target = namespace + url;
      let lo = 0, hi = this.header.articleCount - 1;
      while (lo <= hi) {
        const mid = (lo + hi) >> 1;
        const e = await this.readDirEntry(mid);
        const key = e.namespace + e.url;
        if (key === target) return e;
        if (key < target) lo = mid + 1; else hi = mid - 1;
      }
      return null;
    }

    // Scan article list for namespace A/C entries matching query
    async scanTitles(query, start, limit) {
      const q = query.toLowerCase();
      const results = [];
      const total = this.header.articleCount;
      // When searching, cap scan to avoid hanging; when browsing, scan all to find real articles
      const maxScan = query ? 8000 : total;
      let i = start, scanned = 0;
      while (i < total && results.length < limit && scanned < maxScan) {
        const entry = this.header.hasTitleIndex
          ? await this.getEntryByTitleIdx(i)
          : await this.readDirEntry(i);
        i++; scanned++;
        if (entry.namespace !== 'A' && entry.namespace !== 'C') continue;
        // When browsing (no query), skip redirects to show only real articles
        if (!query && entry.isRedirect) continue;
        if (!query || entry.title.toLowerCase().includes(q))
          results.push({ titleIdx: i - 1, entry });
      }
      return { results, nextStart: i };
    }

    async _clusterOffset(n) {
      const dv = await this._readRange(this.header.clusterPtrPos + n * 8, 8);
      return this._u64(dv, 0);
    }

    async _inflate(data) {
      const ds = new DecompressionStream('deflate-raw');
      const w = ds.writable.getWriter();
      w.write(data); w.close();
      const chunks = [];
      const r = ds.readable.getReader();
      for (;;) { const { done, value } = await r.read(); if (done) break; chunks.push(value); }
      const out = new Uint8Array(chunks.reduce((s, c) => s + c.length, 0));
      let p = 0; for (const c of chunks) { out.set(c, p); p += c.length; }
      return out;
    }

    async _decompress(type, data) {
      if (type === 0 || type === 1) return data;
      if (type === 4) return this._inflate(data);
      // Detect zstd by magic bytes (0xFD2FB528 LE = 28 B5 2F FD).
      // ZIM v6 files may declare compression type 5 but actually contain zstd data.
      const isZstd = type === 7 || (
        data.length >= 4 &&
        data[0] === 0x28 && data[1] === 0xB5 && data[2] === 0x2F && data[3] === 0xFD
      );
      if (isZstd) {
        if (typeof fzstd === 'undefined') {
          await new Promise((res, rej) => {
            const s = document.createElement('script');
            s.src = 'https://cdn.jsdelivr.net/npm/fzstd@0.1.0/umd/index.js';
            s.onload = res;
            s.onerror = () => rej(new Error('Could not load zstd library — connect to the internet once to enable zstd ZIM support'));
            document.head.appendChild(s);
          });
        }
        return fzstd.decompress(data);
      }
      if (type === 5) throw new Error('bzip2 compression is not supported');
      if (type === 6) throw new Error('xz/lzma compression is not supported — use a zstd or zlib ZIM file');
      throw new Error(`Unknown cluster compression type: ${type}`);
    }

    _parseBlobs(data, extended) {
      const os = extended ? 8 : 4;
      const dv = new DataView(data.buffer, data.byteOffset, data.byteLength);
      const getOff = (i) => extended ? this._u64(dv, i * os) : dv.getUint32(i * os, true);
      const count = Math.floor(getOff(0) / os) - 1;
      return Array.from({ length: count }, (_, i) => data.slice(getOff(i), getOff(i + 1)));
    }

    async readBlob(clusterNum, blobNum) {
      const off = await this._clusterOffset(clusterNum);
      const isLast = clusterNum + 1 >= this.header.clusterCount;
      const nextOff = isLast
        ? this.header.checksumPos
        : await this._clusterOffset(clusterNum + 1);
      const size = Math.min(nextOff - off, 128 * 1024 * 1024);
      const raw  = new Uint8Array(await this.file.slice(off, off + size).arrayBuffer());
      const type = raw[0] & 0x0f;
      const ext  = !!(raw[0] & 0x10);
      const data = await this._decompress(type, raw.slice(1));
      const blobs = this._parseBlobs(data, ext);
      if (blobNum >= blobs.length)
        throw new Error(`Blob ${blobNum} out of range (cluster has ${blobs.length})`);
      return blobs[blobNum];
    }

    async getArticle(urlIdx) {
      let entry = await this.readDirEntry(urlIdx);
      for (let i = 0; i < 10 && entry.isRedirect; i++)
        entry = await this.readDirEntry(entry.redirectIndex);
      if (entry.isRedirect) throw new Error('Redirect loop detected');
      const data = await this.readBlob(entry.clusterNum, entry.blobNum);
      return entry.mime.startsWith('text/')
        ? { text: new TextDecoder().decode(data), mime: entry.mime, entry }
        : { blob: new Blob([data], { type: entry.mime }), mime: entry.mime, entry };
    }
  }

  // ── Library state & DOM refs ──
  const ZIM_BOOKMARKS_KEY = 'emergencyHubZimBookmarks';
  let zimReader = null;
  let zimTitleOffset = 0;
  let zimSearchQuery = '';
  let zimBookmarks = [];
  let zimCurrentEntry = null;
  let zimPendingEntry = null;

  const zimLoadingEl    = $('#zim-loading');
  const zimLoadingMsg   = $('#zim-loading-msg');
  const zimContentEl    = $('#zim-content');
  const zimBrowseEl     = $('#zim-browse');
  const zimSearchInput  = $('#zim-search');
  const zimSearchClearBtn = $('#zim-search-clear');
  const zimSearchMeta   = $('#zim-search-meta');
  const zimBookmarksSection = $('#zim-bookmarks-section');
  const zimBookmarksList = $('#zim-bookmarks-list');
  const zimBookmarksClearBtn = $('#zim-bookmarks-clear');
  const zimArticleList  = $('#zim-article-list');
  const zimLoadMoreBtn  = $('#zim-load-more');
  const zimArticleView  = $('#zim-article-view');
  const zimBackBtn      = $('#zim-back-btn');
  const zimArticleTitle = $('#zim-article-title-text');
  const zimBookmarkBtn  = $('#zim-bookmark-btn');
  const zimFrame        = $('#zim-frame');
  const zimErrorEl      = $('#zim-error');

  function _zimEscapeHtml(text) {
    return text
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  function _zimHighlightTitle(title, query) {
    const safeTitle = _zimEscapeHtml(title);
    if (!query) return safeTitle;
    const trimmed = query.trim();
    if (!trimmed) return safeTitle;
    const escapedQuery = trimmed.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    return safeTitle.replace(new RegExp(`(${escapedQuery})`, 'ig'), '<mark>$1</mark>');
  }

  function _zimBookmarkId(entry) {
    return `${entry.namespace}:${entry.url}`;
  }

  function _zimLoadBookmarks() {
    try {
      const raw = localStorage.getItem(ZIM_BOOKMARKS_KEY);
      const data = raw ? JSON.parse(raw) : [];
      zimBookmarks = Array.isArray(data) ? data : [];
    } catch {
      zimBookmarks = [];
    }
  }

  function _zimSaveBookmarks() {
    try {
      localStorage.setItem(ZIM_BOOKMARKS_KEY, JSON.stringify(zimBookmarks));
    } catch {}
  }

  function _zimIsBookmarked(entry) {
    return zimBookmarks.some(bookmark => bookmark.id === _zimBookmarkId(entry));
  }

  function _zimToggleBookmark(entry) {
    const id = _zimBookmarkId(entry);
    const index = zimBookmarks.findIndex(bookmark => bookmark.id === id);
    if (index >= 0) {
      zimBookmarks.splice(index, 1);
    } else {
      zimBookmarks.unshift({
        id,
        urlIdx: entry.urlIdx,
        namespace: entry.namespace,
        url: entry.url,
        title: entry.title,
      });
    }
    _zimSaveBookmarks();
    _zimRenderBookmarks();
    _zimUpdateBookmarkButton();
  }

  function _zimUpdateBookmarkButton() {
    if (!zimCurrentEntry) {
      zimBookmarkBtn.classList.add('hidden');
      zimBookmarkBtn.setAttribute('aria-pressed', 'false');
      return;
    }
    const active = _zimIsBookmarked(zimCurrentEntry);
    zimBookmarkBtn.classList.remove('hidden');
    zimBookmarkBtn.innerHTML = active ? '&#9733;' : '&#9734;';
    zimBookmarkBtn.title = active ? 'Remove bookmark' : 'Save bookmark';
    zimBookmarkBtn.setAttribute('aria-label', active ? 'Remove bookmark' : 'Save bookmark');
    zimBookmarkBtn.setAttribute('aria-pressed', active ? 'true' : 'false');
    zimBookmarkBtn.classList.toggle('is-active', active);
  }

  function _zimCreateArticleCard(entry, { query = '', compact = false } = {}) {
    const card = document.createElement('div');
    card.className = `zim-article-card${compact ? ' zim-article-card--compact' : ''}`;

    const title = document.createElement('span');
    title.className = 'zim-article-card-title';
    title.innerHTML = _zimHighlightTitle(entry.title, query);
    card.appendChild(title);

    const bookmarkBtn = document.createElement('button');
    bookmarkBtn.className = `zim-article-bookmark${_zimIsBookmarked(entry) ? ' is-active' : ''}`;
    bookmarkBtn.type = 'button';
    bookmarkBtn.innerHTML = _zimIsBookmarked(entry) ? '&#9733;' : '&#9734;';
    bookmarkBtn.title = _zimIsBookmarked(entry) ? 'Remove bookmark' : 'Save bookmark';
    bookmarkBtn.setAttribute('aria-label', bookmarkBtn.title);
    bookmarkBtn.addEventListener('click', (event) => {
      event.stopPropagation();
      _zimToggleBookmark(entry);
      bookmarkBtn.classList.toggle('is-active', _zimIsBookmarked(entry));
      bookmarkBtn.innerHTML = _zimIsBookmarked(entry) ? '&#9733;' : '&#9734;';
      bookmarkBtn.title = _zimIsBookmarked(entry) ? 'Remove bookmark' : 'Save bookmark';
      bookmarkBtn.setAttribute('aria-label', bookmarkBtn.title);
      if (compact && !_zimIsBookmarked(entry)) {
        _zimRenderBookmarks();
      }
    });
    card.appendChild(bookmarkBtn);

    card.addEventListener('click', () => _zimOpenArticle(entry));
    return card;
  }

  function _zimRenderBookmarks() {
    zimBookmarksList.textContent = '';
    zimBookmarksSection.classList.toggle('hidden', zimBookmarks.length === 0);
    zimBookmarksClearBtn.classList.toggle('hidden', zimBookmarks.length === 0);
    if (zimBookmarks.length === 0) return;

    zimBookmarks.slice(0, 8).forEach((bookmark) => {
      const card = _zimCreateArticleCard({
        urlIdx: bookmark.urlIdx,
        namespace: bookmark.namespace,
        url: bookmark.url,
        title: bookmark.title,
      }, { compact: true });
      zimBookmarksList.appendChild(card);
    });
  }

  function _zimUpdateSearchMeta(resultCount = 0, reset = false) {
    const hasQuery = !!zimSearchQuery;
    zimSearchClearBtn.classList.toggle('hidden', !hasQuery);
    if (!zimReader) {
      zimSearchMeta.textContent = 'Browse offline articles by title or search for a topic.';
      return;
    }
    if (!hasQuery) {
      zimSearchMeta.textContent = reset
        ? 'Browse offline articles by title or search for a topic.'
        : 'Showing offline article titles from the bundled archive.';
      return;
    }
    if (resultCount === 0 && reset) {
      zimSearchMeta.textContent = `No results for "${zimSearchQuery}". Try a shorter keyword or a broader topic.`;
      return;
    }
    zimSearchMeta.textContent = `Search: "${zimSearchQuery}"${resultCount ? ` — showing ${resultCount} result${resultCount === 1 ? '' : 's'}${zimLoadMoreBtn.classList.contains('hidden') ? '' : ' so far'}` : ''}.`;
  }

  function _zimShow(state) {
    const hasContent = state === 'browse' || state === 'article';
    zimLoadingEl.classList.toggle('hidden', state !== 'loading');
    zimContentEl.classList.toggle('hidden', !hasContent);
    if (hasContent) {
      zimBrowseEl.classList.toggle('hidden', state !== 'browse');
      zimArticleView.classList.toggle('hidden', state !== 'article');
    }
    zimErrorEl.classList.add('hidden');
  }

  function _zimError(msg) {
    zimErrorEl.textContent = msg;
    zimErrorEl.classList.remove('hidden');
  }

  async function zimOpenFile(file) {
    _zimShow('loading');
    zimLoadingMsg.textContent = 'Opening…';
    try {
      const reader = new ZimReader(file);
      await reader.init(msg => { zimLoadingMsg.textContent = msg; });
      zimReader = reader;
      _zimLoadBookmarks();
      zimSearchQuery = '';
      zimSearchInput.value = '';
      zimCurrentEntry = null;
      _zimShow('browse');
      _zimRenderBookmarks();
      _zimUpdateBookmarkButton();
      await _zimRenderList(true);
      if (zimPendingEntry) {
        const pending = zimPendingEntry;
        zimPendingEntry = null;
        await _zimOpenArticle(pending);
      }
    } catch (err) {
      _zimShow('loading'); // keep spinner hidden, show error over content area
      zimContentEl.classList.remove('hidden');
      _zimError(`Failed to open: ${err.message}`);
    }
  }

  function openLibraryFromBookmark(bookmark) {
    const entry = {
      urlIdx: bookmark.urlIdx,
      namespace: bookmark.namespace,
      url: bookmark.url,
      title: bookmark.title,
    };
    navigateTo('page-library');
    if (zimReader) {
      _zimOpenArticle(entry);
    } else {
      zimPendingEntry = entry;
      initLibrary();
    }
  }

  async function _zimRenderList(reset = false) {
    if (reset) {
      zimArticleList.textContent = '';
      zimTitleOffset = 0;
    }
    const { results, nextStart } = await zimReader.scanTitles(zimSearchQuery, zimTitleOffset, 100);
    zimTitleOffset = nextStart;

    if (reset) zimArticleList.textContent = '';
    if (results.length === 0 && !zimArticleList.children.length) {
      const msg = document.createElement('div');
      msg.className = 'zim-empty-state';
      msg.innerHTML = zimSearchQuery
        ? `<strong>No articles found</strong><span>Try another keyword, remove punctuation, or search for a broader topic.</span>`
        : `<strong>Start exploring the offline library</strong><span>Search by title or scroll through the bundled archive.</span>`;
      zimArticleList.appendChild(msg);
      zimLoadMoreBtn.classList.add('hidden');
      _zimUpdateSearchMeta(0, reset);
      return;
    }

    for (const { entry } of results) {
      zimArticleList.appendChild(_zimCreateArticleCard(entry, { query: zimSearchQuery }));
    }
    zimLoadMoreBtn.classList.toggle('hidden', nextStart >= zimReader.header.articleCount);
    _zimUpdateSearchMeta(zimArticleList.querySelectorAll('.zim-article-card').length, reset);
  }

  async function _zimOpenArticle(entry) {
    _zimShow('loading');
    zimLoadingMsg.textContent = `Loading "${entry.title}"…`;
    try {
      const { text, blob, entry: resolved } = await zimReader.getArticle(entry.urlIdx);
      zimCurrentEntry = resolved;
      zimArticleTitle.textContent = resolved.title;
      _zimUpdateBookmarkButton();

      if (text != null) {
        // Strip scripts and event handlers; render in sandboxed iframe (no allow-scripts)
        const clean = text
          .replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, '')
          .replace(/<link\b[^>]*>/gi, '')
          .replace(/\s+on\w+\s*=\s*"[^"]*"/gi, '')
          .replace(/\s+on\w+\s*=\s*'[^']*'/gi, '');

        const injectStyle = `<style>
          /* ── Reset & base ── */
          *{box-sizing:border-box}
          html,body{
            background:#ffffff;color:#1a1a1a;
            font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif;
            margin:0;padding:0;line-height:1.7;font-size:16px;
          }

          /* ── Hide Wikipedia chrome ── */
          #mw-navigation,#mw-head,#mw-panel,#mw-head-base,#mw-page-base,
          #footer,#catlinks,.mw-indicators,.mw-editsection,
          .mw-editsection-bracket,.vector-page-toolbar,.vector-column-start,
          .vector-column-end,.vector-header,.vector-sticky-header,
          .mw-portlet,.mw-portlet-lang,.mw-portlet-coll-print_export,
          #toc,.toc,.mw-toc,.tocnumber,
          .navbox,.navbox-styles,.ambox,.cmbox,.ombox,.tmbox,
          .sistersitebox,.noprint,sup.reference,
          .reflist,.references,.mw-references-wrap,
          .hatnote,.hatnote-icon,
          .mw-jump-link,a.mw-selflink{display:none!important}

          /* ── Content container ── */
          #content,#mw-content-text,.mw-body,.mw-body-content,
          .mw-page-container,.mw-page-container-inner,
          #bodyContent,#mw-content-block{
            background:transparent!important;border:none!important;
            margin:0!important;padding:0!important;max-width:none!important;
            float:none!important;
          }
          .mw-parser-output{
            padding:16px 18px 40px;max-width:720px;margin:0 auto;
          }

          /* ── Typography ── */
          h1,#firstHeading,.mw-first-heading{
            font-size:1.6em;font-weight:700;color:#111;
            border-bottom:1px solid #d0d0d0;padding-bottom:.4em;margin:0 0 .8em;
          }
          h2{font-size:1.25em;font-weight:600;color:#222;
            border-bottom:1px solid #e0e0e0;padding-bottom:.2em;margin:1.4em 0 .5em}
          h3{font-size:1.05em;font-weight:600;color:#333;margin:1.2em 0 .4em}
          h4,h5,h6{font-size:.95em;font-weight:600;color:#555;margin:1em 0 .3em}
          p{margin:0 0 .8em}

          /* ── Links ── */
          a{color:#0645ad;text-decoration:none}
          a:hover{text-decoration:underline;color:#0b0080}

          /* ── Images ── */
          img{max-width:100%;height:auto;border-radius:4px;display:block;margin:.5em auto}
          figure,figcaption{max-width:100%}
          figcaption{font-size:.8em;color:#666;text-align:center;margin-top:.3em}
          .thumb,.thumbinner,.thumbcaption{
            max-width:100%!important;width:auto!important;float:none!important;
            display:block;margin:.8em auto!important;
          }

          /* ── Tables ── */
          table{border-collapse:collapse;width:100%;font-size:.85em;margin:.8em 0;
            overflow-x:auto;display:block}
          td,th{border:1px solid #c8ccd1;padding:6px 10px;text-align:left;
            background:#fff;vertical-align:top}
          th{background:#eaecf0;color:#222;font-weight:600}
          tr:nth-child(even) td{background:#f8f9fa}
          .wikitable{border:1px solid #a2a9b1}

          /* ── Infobox ── */
          .infobox,.infobox_v3,.ib-person,.ib-company{
            float:none!important;clear:both;width:100%!important;max-width:100%!important;
            margin:0 0 1.2em!important;background:#f8f9fa!important;
            border:1px solid #a2a9b1!important;border-radius:6px!important;
            font-size:.85em!important;
          }
          .infobox caption,.infobox_v3 caption{
            background:#eaecf0!important;color:#222!important;
            font-weight:600;padding:6px 10px;border-radius:6px 6px 0 0;
          }

          /* ── Code ── */
          pre,code,kbd,samp{
            background:#f6f8fa;border:1px solid #d0d7de;border-radius:4px;
            font-family:"SFMono-Regular",Consolas,monospace;font-size:.85em;color:#1a1a1a;
          }
          code{padding:1px 5px}
          pre{padding:10px 14px;overflow-x:auto;line-height:1.5}

          /* ── Blockquote ── */
          blockquote{
            border-left:3px solid #0645ad;margin:1em 0;
            padding:.4em 1em;background:#f0f4ff;color:#333;
            border-radius:0 4px 4px 0;
          }

          /* ── Lists ── */
          ul,ol{padding-left:1.5em;margin:.5em 0 .8em}
          li{margin:.2em 0}

          /* ── Horizontal rules ── */
          hr{border:none;border-top:1px solid #d0d0d0;margin:1.2em 0}
        </style>`;

        const html = /<html[\s>]/i.test(clean)
          ? clean.replace(/<head(\s[^>]*)?>/i, m => m + injectStyle)
          : `<html><head>${injectStyle}</head><body>${clean}</body></html>`;

        // Render in sandboxed iframe (allow-same-origin only; no allow-scripts)
        zimFrame.srcdoc = html;
        zimFrame.onload = () => {
          try {
            zimFrame.contentDocument.addEventListener('click', e => {
              const a = e.target.closest('a[href]');
              if (!a) return;
              e.preventDefault();
              _zimHandleLink(a.getAttribute('href'));
            });
          } catch { /* sandboxed */ }
        };
      } else {
        zimFrame.srcdoc = '';
        zimFrame.src = URL.createObjectURL(blob);
      }
      _zimShow('article');
    } catch (err) {
      _zimShow('browse');
      _zimError(`Failed to load article: ${err.message}`);
    }
  }

  async function _zimHandleLink(href) {
    if (!href || href.startsWith('#') || href.startsWith('javascript:')) return;
    if (/^https?:\/\//i.test(href)) { window.open(href, '_blank', 'noopener'); return; }

    // Strip hash fragment, then strip leading ./ and ../ hops
    const clean = href.split('#')[0];
    if (!clean) return;
    const path = clean.replace(/^(\.\.\/|\.\/)+/, '');
    const slash = path.indexOf('/');

    let ns, url;
    if (slash < 0) {
      // ZIM v6 links: no namespace prefix (e.g. "./Amazon_(company)")
      ns  = 'C';
      url = decodeURIComponent(path).replace(/ /g, '_');
    } else {
      ns  = path.slice(0, slash);
      url = decodeURIComponent(path.slice(slash + 1)).replace(/ /g, '_');
    }

    _zimShow('loading');
    zimLoadingMsg.textContent = 'Navigating…';
    try {
      const found = await zimReader.findByUrl(ns, url);
      if (!found) throw new Error(`Not found in ZIM: ${ns}/${url}`);
      await _zimOpenArticle(found);
    } catch (err) {
      _zimShow('article');
      _zimError(`Link error: ${err.message}`);
    }
  }

  // Auto-open the bundled ZIM on first library visit
  function initLibrary() {
    if (zimReader) return; // already loaded
    zimOpenFile(new HttpFile(BUNDLED_ZIM.url, BUNDLED_ZIM.name));
  }

  // Library event listeners
  zimBackBtn.addEventListener('click', () => _zimShow('browse'));
  zimBookmarkBtn.addEventListener('click', () => {
    if (zimCurrentEntry) _zimToggleBookmark(zimCurrentEntry);
  });
  zimBookmarksClearBtn.addEventListener('click', () => {
    zimBookmarks = [];
    _zimSaveBookmarks();
    _zimRenderBookmarks();
    _zimUpdateBookmarkButton();
  });
  zimLoadMoreBtn.addEventListener('click', () => _zimRenderList(false));
  zimSearchClearBtn.addEventListener('click', () => {
    zimSearchInput.value = '';
    zimSearchQuery = '';
    _zimRenderList(true);
    zimSearchInput.focus();
  });

  let _zimSearchTimer;
  zimSearchInput.addEventListener('input', () => {
    clearTimeout(_zimSearchTimer);
    _zimSearchTimer = setTimeout(() => {
      zimSearchQuery = zimSearchInput.value.trim();
      _zimRenderList(true);
    }, 300);
  });

  // ──────────── Init ────────────
  loadState();
  refreshHome();
  loadScenarios();
})();
