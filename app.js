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
    {
      id: "gas_leak",
      icon: "💨",
      title: "Gas Leak",
      color: "#52b788",
      steps: [
        { title: "Do NOT use any ignition source", desc: "No light switches, matches, lighters, or electrical appliances. Even a phone call can spark an explosion — wait until you are outside." },
        { title: "Evacuate immediately", desc: "Leave the building at once. Do not stop to collect belongings. Leave doors open as you go to ventilate the space." },
        { title: "Do NOT use the lift", desc: "Take the stairs. A spark from the lift motor could ignite accumulated gas." },
        { title: "Move well away from the building", desc: "Go at least 100 m upwind. Keep bystanders back and prevent anyone from entering." },
        { title: "Call emergency services", desc: "From a safe distance, call the fire brigade and your gas utility. Give the address and describe what you smelled." },
        { title: "Do not re-enter", desc: "Only return when emergency services declare the building safe. Ventilate thoroughly before using any appliances." },
      ],
    },
    {
      id: "building_fire",
      icon: "🏠",
      title: "Building Fire",
      color: "#e63946",
      steps: [
        { title: "Alert everyone", desc: "Activate the nearest fire alarm pull station. Shout 'FIRE!' to alert others on your floor." },
        { title: "Call 112 (emergency services)", desc: "Report the exact address, floor, and what is burning. Stay on the line if safe to do so." },
        { title: "Evacuate — stay low", desc: "Crawl below the smoke. Touch doors before opening — if hot, do NOT open; find another exit." },
        { title: "Use stairs only", desc: "Never use the lift during a fire. Feel each door before opening it; close doors behind you to slow fire spread." },
        { title: "If you cannot escape", desc: "Seal door gaps with cloth, open a window and signal for help. Stay near the floor where air is cleaner." },
        { title: "Once outside, stay out", desc: "Assemble at the designated muster point. Account for everyone and report missing persons to firefighters." },
      ],
    },
    {
      id: "medical_emergency",
      icon: "🩺",
      title: "Medical Emergency",
      color: "#e63946",
      steps: [
        { title: "Assess the scene", desc: "Ensure the scene is safe before approaching. Look for hazards such as traffic, fire, or unstable structures." },
        { title: "Call 112 (emergency services)", desc: "Provide location, nature of emergency, number of casualties, and your phone number. Stay on the line." },
        { title: "Check responsiveness", desc: "Tap the person's shoulder and shout 'Are you OK?'. If no response, check for normal breathing." },
        { title: "Start CPR if needed", desc: "If not breathing normally: 30 chest compressions (5–6 cm deep, 100–120/min) then 2 rescue breaths. Repeat until help arrives." },
        { title: "Use an AED if available", desc: "Automated Defibrillators (AEDs) are in many public buildings. Switch it on and follow the voice instructions exactly." },
        { title: "Control severe bleeding", desc: "Apply firm, continuous pressure with a cloth. Do not remove a dressing — add more on top. Elevate the limb if possible." },
        { title: "Keep the person warm and calm", desc: "Cover with a blanket to prevent shock. Do not give food or water. Reassure them until paramedics arrive." },
      ],
    },
    {
      id: "hazmat",
      icon: "☣️",
      title: "Hazmat / Chemical Spill",
      color: "#606c38",
      steps: [
        { title: "Move away immediately", desc: "Move upwind, uphill, and upstream from the spill. Do not walk through visible vapours, fumes, or liquids." },
        { title: "Call 112", desc: "Report the location, name of the substance if known, and number of people affected. Do not re-enter the area." },
        { title: "If exposure occurs — flush skin/eyes", desc: "Remove contaminated clothing. Flush affected skin or eyes with large amounts of clean water for at least 15 minutes." },
        { title: "Shelter in place if directed", desc: "If authorities say shelter in place: go inside, close all windows and doors, turn off HVAC, and seal gaps with tape and damp towels." },
        { title: "Do not eat, drink, or smoke", desc: "Avoid touching your face until fully decontaminated. Hazardous materials can be absorbed through skin and mucous membranes." },
        { title: "Follow official guidance", desc: "Wait for emergency services to give the all-clear before returning to the area or removing shelter-in-place measures." },
      ],
    },
    {
      id: "nuclear_radiation",
      icon: "☢️",
      title: "Nuclear / Radiation Alert",
      color: "#7b2d8b",
      steps: [
        { title: "Get inside", desc: "Enter the nearest substantial building. Brick, concrete, and underground spaces provide the best shielding. Avoid wooden structures." },
        { title: "Stay inside", desc: "Close all windows, doors, and fireplace dampers. Turn off fans, air conditioning, and heating that draws outside air." },
        { title: "Go to the inner core of the building", desc: "Move to the basement or the centre of the building, away from windows and exterior walls, to maximise shielding." },
        { title: "Tune to emergency broadcasts", desc: "Follow official instructions from national emergency management (Finland: Yle Radio 1 / YLE website). Do not rely on rumours." },
        { title: "Take potassium iodide (KI) only if instructed", desc: "KI protects only the thyroid from radioactive iodine. Take it ONLY if authorities advise — timing matters critically." },
        { title: "Decontaminate if you were outside", desc: "Remove outer clothing (removes ~80% of contamination), shower with soap and water, blow nose gently, and change into clean clothes." },
      ],
    },
    {
      id: "missing_person",
      icon: "🔍",
      title: "Missing Person",
      color: "#023e8a",
      steps: [
        { title: "Check common locations first", desc: "Search the home thoroughly, then contact friends, school, and workplace. Check recent messages and social media for clues." },
        { title: "Call 112 (or local police non-emergency)", desc: "Report a missing person immediately — there is no mandatory waiting period. Give name, age, description, last known location, and time last seen." },
        { title: "Gather key information", desc: "Collect a recent photo, description of clothing, medical conditions, medications needed, and a list of known contacts and frequent locations." },
        { title: "Preserve evidence", desc: "Do not clean the person's room. Their phone, computer, and belongings may be important for investigators." },
        { title: "Coordinate search efforts", desc: "Work with police to organize volunteer searches. Use the Map feature to mark searched areas and locations of interest." },
        { title: "Use Timers to track search shifts", desc: "Set countdown timers for search shifts to ensure searchers rest and rotate safely." },
        { title: "Keep communication channels open", desc: "Designate one person as communication coordinator. Post updates carefully — avoid sharing information that could compromise the search." },
      ],
    },
    {
      id: "cyber_blackout",
      icon: "🖥️",
      title: "Cyber Attack / Grid Failure",
      color: "#495057",
      steps: [
        { title: "Assume extended outage", desc: "A coordinated infrastructure attack may last days to weeks. Begin rationing supplies and switching to manual backups immediately." },
        { title: "Secure cash and physical documents", desc: "ATMs and card payments may be unavailable. Keep emergency cash, ID documents, and medical records accessible." },
        { title: "Protect drinking water", desc: "Water pumping stations may fail. Fill bathtubs, large containers, and any available vessels immediately." },
        { title: "Fuel vehicles and generators early", desc: "Fuel pumps require power. Refuel as soon as possible; avoid long queues later." },
        { title: "Limit device use", desc: "Conserve phone battery for emergencies. Turn off Wi-Fi and Bluetooth when not in use; enable low-power mode." },
        { title: "Monitor official broadcasts", desc: "Use a battery or hand-crank radio to receive emergency instructions. Avoid spreading unverified information." },
        { title: "Cooperate with neighbours", desc: "Share resources, check on vulnerable people, and establish a local communication system (e.g., notice board or in-person check-ins)." },
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

  chatInput.addEventListener("keydown", e => {
    if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); chatSend(); }
  });
  chatInput.addEventListener("input", () => {
    chatInput.style.height = "auto";
    chatInput.style.height = chatInput.scrollHeight + "px";
  });

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
    url:  './wikipedia_en_100_mini_2026-01.zim',
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
  let zimReader = null;
  let zimTitleOffset = 0;
  let zimSearchQuery = '';

  const zimLoadingEl    = $('#zim-loading');
  const zimLoadingMsg   = $('#zim-loading-msg');
  const zimContentEl    = $('#zim-content');
  const zimBrowseEl     = $('#zim-browse');
  const zimSearchInput  = $('#zim-search');
  const zimArticleList  = $('#zim-article-list');
  const zimLoadMoreBtn  = $('#zim-load-more');
  const zimArticleView  = $('#zim-article-view');
  const zimBackBtn      = $('#zim-back-btn');
  const zimArticleTitle = $('#zim-article-title-text');
  const zimFrame        = $('#zim-frame');
  const zimErrorEl      = $('#zim-error');

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
      zimSearchQuery = '';
      zimSearchInput.value = '';
      _zimShow('browse');
      await _zimRenderList(true);
    } catch (err) {
      _zimShow('loading'); // keep spinner hidden, show error over content area
      zimContentEl.classList.remove('hidden');
      _zimError(`Failed to open: ${err.message}`);
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
      const msg = document.createElement('p');
      msg.className = 'empty-msg';
      msg.textContent = 'No articles found';
      zimArticleList.appendChild(msg);
      zimLoadMoreBtn.classList.add('hidden');
      return;
    }

    for (const { entry } of results) {
      const card = document.createElement('div');
      card.className = 'zim-article-card';
      const title = document.createElement('span');
      title.textContent = entry.title;
      card.appendChild(title);
      card.addEventListener('click', () => _zimOpenArticle(entry));
      zimArticleList.appendChild(card);
    }
    zimLoadMoreBtn.classList.toggle('hidden', nextStart >= zimReader.header.articleCount);
  }

  async function _zimOpenArticle(entry) {
    _zimShow('loading');
    zimLoadingMsg.textContent = `Loading "${entry.title}"…`;
    try {
      const { text, blob, entry: resolved } = await zimReader.getArticle(entry.urlIdx);
      zimArticleTitle.textContent = resolved.title;

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
  zimLoadMoreBtn.addEventListener('click', () => _zimRenderList(false));

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
})();
