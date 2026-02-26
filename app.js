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
    pages.forEach(p => p.classList.toggle("active", p.id === pageId));
    navBtns.forEach(b => b.classList.toggle("active", b.dataset.target === pageId));
    if (pageId === "page-map") {
      requestAnimationFrame(() => requestAnimationFrame(() => map.invalidateSize()));
    }
    if (pageId === "page-home") refreshHome();
    if (pageId === "page-chat") chatInit();
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

  // Uses the locally bundled finland.pmtiles – zero network requests needed.
  const pmLayer = protomapsL.leafletLayer({
    url: "./finland.pmtiles",
    flavor: "dark",
    lang: "en",
  }).addTo(map);

  // Force canvas repaint after zoom so tiles never stay blank
  map.on("zoomend", () => { map.invalidateSize(); pmLayer.redraw(); });

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
    poiListEl.innerHTML = "";
    state.pois.forEach(poi => {
      const li = document.createElement("li");
      li.innerHTML = `
        <div class="poi-info">
          <div class="poi-name">${categoryIcons[poi.category] || "📌"} ${poi.name}</div>
          <div class="poi-cat">${poi.category} · ${poi.lat.toFixed(4)}, ${poi.lng.toFixed(4)}</div>
        </div>
        <button class="poi-remove-btn" data-id="${poi.id}">Remove</button>
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
  function refreshHome() {
    // Timers
    const activeTimers = state.timers.filter(t => t.running);
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

  // ──────────── Service Worker (app shell only) ────────────
  const offlineBadge = $("#offline-badge");
  function updateOnlineStatus() {
    offlineBadge.classList.toggle("hidden", navigator.onLine);
  }
  window.addEventListener("online", updateOnlineStatus);
  window.addEventListener("offline", updateOnlineStatus);
  updateOnlineStatus();

  if ("serviceWorker" in navigator) {
    navigator.serviceWorker.register("./sw.js").catch(() => {});
  }

  // ──────────── Emergency Scenarios ────────────
  const SCENARIOS = [
    {
      id: "earthquake",
      icon: "🌍",
      title: "Earthquake",
      color: "#e07b39",
      steps: [
        { title: "DROP to the ground", desc: "Get on your hands and knees to prevent being knocked down. This position protects vital organs." },
        { title: "Take COVER", desc: "Get under a sturdy desk or table. If no shelter, cover your head and neck with your arms against an interior wall." },
        { title: "HOLD ON", desc: "Stay under cover until the shaking stops. Be prepared for aftershocks." },
        { title: "Evacuate if needed", desc: "Once shaking stops, check for injuries and hazards. Exit calmly. Do NOT use elevators." },
        { title: "Check for damage", desc: "Look for gas leaks, electrical damage, and structural issues. Turn off utilities if you suspect damage." },
        { title: "Contact emergency services", desc: "Call local emergency number. Use the Timers feature to track response ETA." },
      ],
    },
    {
      id: "flood",
      icon: "🌊",
      title: "Flood",
      color: "#457b9d",
      steps: [
        { title: "Move to higher ground", desc: "If flooding is imminent, move immediately to higher ground. Do NOT wait for instructions." },
        { title: "Avoid walking in water", desc: "Just 15 cm (6 inches) of moving water can knock you down. Never walk through flowing water." },
        { title: "Do NOT drive through floods", desc: "30 cm of water can float a vehicle. Turn around — don't drown." },
        { title: "Disconnect utilities", desc: "Turn off electricity and gas if safe to do so. Avoid contact with floodwater — it may be contaminated." },
        { title: "Signal for help", desc: "If trapped, go to the highest point. Use a flashlight or bright cloth to signal rescuers." },
        { title: "Wait for the all-clear", desc: "Do not return home until authorities say it is safe. Watch for damaged roads and bridges." },
      ],
    },
    {
      id: "tornado",
      icon: "🌪️",
      title: "Tornado",
      color: "#8338ec",
      steps: [
        { title: "Seek shelter immediately", desc: "Go to a basement, storm cellar, or the lowest floor of a sturdy building." },
        { title: "Go interior", desc: "Move to an interior room or hallway, away from windows, doors, and exterior walls." },
        { title: "Protect yourself", desc: "Get under a heavy piece of furniture. Cover your head and neck with your arms or a mattress." },
        { title: "If outdoors", desc: "Lie flat in the nearest ditch or low area. Cover your head. Do NOT shelter under highway overpasses." },
        { title: "If in a vehicle", desc: "Do NOT try to outrun a tornado. Park, keep your seatbelt on, duck below windows, and cover your head." },
        { title: "After the tornado", desc: "Watch for debris, downed power lines, and gas leaks. Help injured neighbours if safe." },
      ],
    },
    {
      id: "power_outage",
      icon: "🔦",
      title: "Power Outage",
      color: "#ffd166",
      steps: [
        { title: "Stay calm & assess", desc: "Check if the outage is just your home or the whole area. Look outside for other buildings without lights." },
        { title: "Use flashlights", desc: "Avoid candles due to fire risk. Use battery-powered or phone flashlights." },
        { title: "Preserve food", desc: "Keep fridge and freezer doors closed. A full freezer stays cold for ~48 hours; half for ~24 hours." },
        { title: "Unplug electronics", desc: "Turn off or disconnect appliances to prevent damage from power surges when electricity returns." },
        { title: "Stay warm / cool", desc: "In cold weather: layer clothing, gather in one room. In heat: stay hydrated, move to the lowest floor." },
        { title: "Check on neighbours", desc: "Especially elderly or disabled people who may need assistance." },
      ],
    },
    {
      id: "forest_fire",
      icon: "🔥",
      title: "Forest Fire",
      color: "#d62828",
      steps: [
        { title: "Evacuate early", desc: "Do not wait until fire is visible. Leave as soon as an evacuation order or warning is issued — roads can quickly become gridlocked." },
        { title: "Close all windows & doors", desc: "Shut every opening to slow smoke and ember entry. Leave them unlocked for firefighters." },
        { title: "Seal gaps with wet towels", desc: "Block door gaps and vents with damp cloth to reduce smoke infiltration." },
        { title: "Remove flammable items", desc: "Move furniture, curtains and other flammables away from windows and exterior walls if time allows." },
        { title: "Follow evacuation routes", desc: "Use designated routes only. Avoid roads that go toward the fire. If smoke is thick, drive with headlights on." },
        { title: "If trapped outdoors", desc: "Move to a clearing away from vegetation. Lie face-down and cover exposed skin. Breathe through a wet cloth." },
        { title: "Report the fire", desc: "Call emergency services with your GPS location. Note wind direction — fire travels fast downwind." },
      ],
    },
    {
      id: "tsunami",
      icon: "🌊",
      title: "Tsunami",
      color: "#0077b6",
      steps: [
        { title: "Recognize natural warnings", desc: "Strong ground shaking near the coast is a natural warning. You may also notice the sea pulling back dramatically." },
        { title: "Move inland immediately", desc: "Go to high ground — at least 30 m above sea level or 3 km inland — right away. Do NOT wait for an official warning." },
        { title: "Avoid the shore", desc: "Never go to the beach to watch a tsunami. The first wave may not be the largest." },
        { title: "Stay away from rivers", desc: "Tsunamis travel up rivers and streams. Avoid waterways near the coast." },
        { title: "Wait for the all-clear", desc: "Tsunamis can last hours with multiple waves. Do not return to low ground until authorities confirm it is safe." },
        { title: "After the waves", desc: "Avoid floodwater — it may contain debris. Check for injuries, gas leaks, and structural damage before entering buildings." },
      ],
    },
    {
      id: "blizzard",
      icon: "❄️",
      title: "Blizzard",
      color: "#90e0ef",
      steps: [
        { title: "Stay indoors", desc: "Avoid travelling during a blizzard. If you must go out, tell someone your route and expected return time." },
        { title: "Layer up", desc: "Wear multiple thin layers, a windproof outer layer, insulated gloves, and a hat. Cover all exposed skin." },
        { title: "Prevent hypothermia & frostbite", desc: "Watch for shivering, confusion, or numb/white skin. Move indoors and warm gradually — do not rub frostbitten skin." },
        { title: "Conserve heating fuel", desc: "Lower the thermostat, close off unused rooms, and use blankets to retain heat." },
        { title: "If stranded in a vehicle", desc: "Stay in the car — it is your best shelter. Run the engine 10 min/hour for heat, clear the exhaust pipe, and keep a window cracked." },
        { title: "Avoid overexertion", desc: "Shovelling snow can cause heart attacks. Take breaks, drink warm fluids, and never shovel alone." },
      ],
    },
    {
      id: "heatwave",
      icon: "☀️",
      title: "Heatwave",
      color: "#f4a261",
      steps: [
        { title: "Stay cool", desc: "Stay in air-conditioned spaces. If you have no AC, visit a library, shopping centre, or community cooling centre." },
        { title: "Hydrate constantly", desc: "Drink water every 15–20 minutes even if not thirsty. Avoid alcohol and caffeine — they dehydrate you." },
        { title: "Dress lightly", desc: "Wear loose, light-coloured, breathable clothing and a wide-brimmed hat when outdoors." },
        { title: "Never leave people / pets in cars", desc: "A car interior can reach 50 °C in minutes. Even with windows cracked, it is fatal." },
        { title: "Recognise heat stroke", desc: "Signs: body temp above 39 °C, hot dry skin, confusion. Call emergency services and cool the person immediately with wet cloths or ice packs." },
        { title: "Check on vulnerable people", desc: "Elderly, infants, and those with chronic illness are at highest risk. Visit or call them regularly." },
      ],
    },
    {
      id: "landslide",
      icon: "⛰️",
      title: "Landslide",
      color: "#6d4c41",
      steps: [
        { title: "Know the warning signs", desc: "Watch for new cracks in ground or walls, tilting trees/poles, unusual sounds of cracking wood or rumbling." },
        { title: "Evacuate immediately", desc: "If you hear cracking, feel ground movement, or see debris flow — evacuate at right angles to the flow, not downhill." },
        { title: "Avoid river valleys", desc: "Landslides commonly follow watercourses. Move away from stream beds and drainage channels." },
        { title: "If you cannot escape", desc: "Curl into a tight ball and protect your head with your arms." },
        { title: "After a landslide", desc: "Stay away from the slide area — secondary slides are common. Check for injured people only from a safe distance and call emergency services." },
        { title: "Report damage", desc: "Notify authorities about blocked roads, damaged utilities, and any missing persons. Avoid entering buildings that may be structurally compromised." },
      ],
    },
  ];

  const scenarioCategoriesEl = $("#scenario-categories");
  const scenarioDetail = $("#scenario-detail");
  const scenarioDetailContent = $("#scenario-detail-content");
  const scenarioBackBtn = $("#scenario-back-btn");

  function renderScenarioCards() {
    scenarioCategoriesEl.innerHTML = "";
    SCENARIOS.forEach((sc) => {
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

  renderScenarioCards();

  // ──────────── AI Chat (Ollama) ────────────
  const OLLAMA_BASE = "http://localhost:11434";
  const SYSTEM_PROMPT = `You are an expert emergency preparedness assistant embedded in an offline mobile app called Emergency Hub.
Provide clear, concise, actionable advice on first aid, survival, evacuation, natural disasters, and emergency procedures.
Keep answers brief (2-5 sentences unless a step-by-step list is needed). Never recommend illegal actions.`;

  const chatModelSelect = $("#chat-model-select");
  const chatStatusEl    = $("#chat-status");
  const chatMessagesEl  = $("#chat-messages");
  const chatInput       = $("#chat-input");
  const chatSendBtn     = $("#chat-send-btn");
  const chatClearBtn    = $("#chat-clear-btn");
  const chatMicBtn      = $("#chat-mic-btn");

  let chatHistory = [];
  let chatReady   = false;
  let chatInited  = false;

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
    if (!text || !chatReady) return;
    const model = chatModelSelect.value;
    if (!model) return;

    chatInput.value = "";
    chatInput.style.height = "auto";
    chatSendBtn.disabled = true;

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
    chatSendBtn.disabled = false;
    chatInput.focus();
  }

  chatClearBtn.addEventListener("click", () => {
    chatHistory = [];
    chatMessagesEl.innerHTML = `<div class="chat-bubble chat-bubble--assistant"><p>Chat cleared. How can I help you?</p></div>`;
  });

  chatSendBtn.addEventListener("click", chatSend);

  // ── Offline voice input (Whisper via transformers.js Web Worker) ──
  let whisperWorker  = null;
  let whisperReady   = false;
  let isRecording    = false;
  let mediaRecorder  = null;
  let audioChunks    = [];

  function micSetStatus(placeholder, title) {
    chatInput.placeholder = placeholder;
    chatMicBtn.title = title;
  }

  function micReset() {
    isRecording = false;
    chatMicBtn.classList.remove("recording");
    micSetStatus("Ask a question…", whisperReady ? "Voice input (offline)" : "Voice input");
  }

  function initWhisperWorker() {
    if (whisperWorker) return;
    whisperWorker = new Worker("./whisper-worker.js");
    whisperWorker.onmessage = ({ data }) => {
      if (data.type === "status") {
        micSetStatus(data.msg, data.msg);
      } else if (data.type === "ready") {
        whisperReady = true;
        micSetStatus("Ask a question…", "Voice input (offline)");
      } else if (data.type === "result") {
        micReset();
        const trimmed = data.text;
        if (trimmed) {
          chatInput.value = chatInput.value ? chatInput.value + " " + trimmed : trimmed;
          chatInput.style.height = "auto";
          chatInput.style.height = chatInput.scrollHeight + "px";
        }
      } else if (data.type === "error") {
        micReset();
        chatAppend("assistant", `Transcription error: ${data.msg}`, true);
      }
    };
    whisperWorker.postMessage({ type: "load" });
  }

  async function startRecording() {
    let stream;
    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: true, video: false });
    } catch (e) {
      chatAppend("assistant", "Microphone access denied. Please allow microphone permissions in your browser.", true);
      return;
    }

    audioChunks = [];
    // Prefer webm/opus; fall back to whatever the browser supports
    const mimeType = ["audio/webm;codecs=opus", "audio/webm", "audio/ogg"].find(
      t => MediaRecorder.isTypeSupported(t)
    ) || "";
    mediaRecorder = new MediaRecorder(stream, mimeType ? { mimeType } : {});

    mediaRecorder.ondataavailable = e => { if (e.data.size > 0) audioChunks.push(e.data); };

    mediaRecorder.onstop = async () => {
      stream.getTracks().forEach(t => t.stop());
      micSetStatus("Transcribing…", "Transcribing…");
      try {
        const blob = new Blob(audioChunks, { type: mediaRecorder.mimeType || "audio/webm" });
        const arrayBuffer = await blob.arrayBuffer();
        // Decode and resample to 16 kHz mono (required by Whisper)
        const audioCtx = new OfflineAudioContext(1, 1, 16000);
        const decoded  = await new AudioContext().decodeAudioData(arrayBuffer);
        const offline  = new OfflineAudioContext(1, Math.ceil(decoded.duration * 16000), 16000);
        const src = offline.createBufferSource();
        src.buffer = decoded;
        src.connect(offline.destination);
        src.start(0);
        const resampled = await offline.startRendering();
        const float32   = resampled.getChannelData(0);
        whisperWorker.postMessage({ type: "transcribe", audio: float32 }, [float32.buffer]);
      } catch (e) {
        micReset();
        chatAppend("assistant", `Audio processing error: ${e.message}`, true);
      }
    };

    mediaRecorder.start();
    isRecording = true;
    chatMicBtn.classList.add("recording");
    micSetStatus("Recording… tap to stop", "Stop recording");
  }

  chatMicBtn.addEventListener("click", () => {
    if (!whisperWorker) {
      // First tap: load model + start recording simultaneously
      initWhisperWorker();
      startRecording();
      return;
    }
    if (isRecording) {
      mediaRecorder?.stop();
      isRecording = false;
      chatMicBtn.classList.remove("recording");
      micSetStatus("Transcribing…", "Transcribing…");
    } else {
      if (!whisperReady) {
        chatAppend("assistant", "Speech model is still loading, please wait a moment.", true);
        return;
      }
      startRecording();
    }
  });
  chatInput.addEventListener("keydown", e => {
    if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); chatSend(); }
  });
  chatInput.addEventListener("input", () => {
    chatInput.style.height = "auto";
    chatInput.style.height = chatInput.scrollHeight + "px";
  });

  // ──────────── Init ────────────
  loadState();
  refreshHome();
})();
