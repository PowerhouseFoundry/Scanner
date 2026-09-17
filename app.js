(() => {
  "use strict";

  const app = document.querySelector("#app");
  const cfg = window.SCANNER_FIREBASE || { enabled: false };
  const BUS_IMG = "assets/bus-reader.png";
  const PAY_IMG = "assets/payment-reader.png";
  const HOLD_TIME = 1650;
  const RESET_TIME = 3200;

  let db = null;
  let firebasePromise = null;
  let channel = null;
  let stopListening = null;
  let holdTimer = null;
  let stageTimers = [];
  let resetTimer = null;
  let currentSession = null;
  let currentMode = null;
  let audio = null;
  let firebaseError = "";

  const nfcSvg = `<svg class="nfc" viewBox="0 0 200 200" aria-hidden="true">
    <g fill="none" stroke="currentColor" stroke-width="12" stroke-linecap="round">
      <path d="M55 70c24 16 24 44 0 60"/>
      <path d="M82 48c42 29 42 75 0 104"/>
      <path d="M111 28c58 41 58 103 0 144"/>
    </g>
  </svg>`;

  function view(html) {
    app.innerHTML = html;
  }

  function newCode() {
    return String(Math.floor(1000 + Math.random() * 9000));
  }

  function storageKey() {
    return `travel-scanner:${currentSession}`;
  }

  function firebaseConfigured() {
    return Boolean(cfg.enabled && cfg.config && cfg.config.databaseURL);
  }

  function loadScript(src) {
    return new Promise((resolve, reject) => {
      const script = document.createElement("script");
      script.src = src;
      script.onload = resolve;
      script.onerror = () => reject(new Error("Firebase could not be loaded."));
      document.head.appendChild(script);
    });
  }

  async function initFirebase() {
    if (!firebaseConfigured()) return false;
    if (db) return true;
    if (firebasePromise) return firebasePromise;
    firebasePromise = (async () => {
      try {
        if (!window.firebase) {
          await loadScript("https://www.gstatic.com/firebasejs/10.12.5/firebase-app-compat.js");
        }
        if (!firebase.database) {
          await loadScript("https://www.gstatic.com/firebasejs/10.12.5/firebase-database-compat.js");
        }
        if (!firebase.auth) {
          await loadScript("https://www.gstatic.com/firebasejs/10.12.5/firebase-auth-compat.js");
        }
        if (!firebase.apps.length) firebase.initializeApp(cfg.config);
        await firebase.auth().signInAnonymously();
        db = firebase.database();
        firebaseError = "";
        return true;
      } catch (error) {
        console.error(error);
        firebaseError = error?.code || error?.message || "Firebase connection failed.";
        firebasePromise = null;
        return false;
      }
    })();
    return firebasePromise;
  }

  function safeReadLocal() {
    try {
      const saved = localStorage.getItem(storageKey());
      return saved ? JSON.parse(saved) : null;
    } catch (error) {
      console.warn("Local pairing is unavailable.", error);
      return null;
    }
  }

  function safeWriteLocal(data) {
    try {
      localStorage.setItem(storageKey(), JSON.stringify(data));
      return true;
    } catch (error) {
      console.warn("Local pairing is unavailable.", error);
      return false;
    }
  }

  function send(data) {
    const packet = { ...data, mode: currentMode, at: Date.now() };
    if (db) db.ref(`sessions/${currentSession}`).update(packet).catch(console.error);
    safeWriteLocal(packet);
    channel?.postMessage(packet);
  }

  function stopCurrentListener() {
    stopListening?.();
    stopListening = null;
  }

  function listen(handler) {
    stopCurrentListener();
    const storageHandler = (event) => {
      if (event.key !== storageKey() || !event.newValue) return;
      try {
        handler(JSON.parse(event.newValue));
      } catch (error) {
        console.error(error);
      }
    };

    if ("BroadcastChannel" in window) {
      channel = new BroadcastChannel(`travel-scanner-${currentSession}`);
      channel.onmessage = (event) => handler(event.data);
    }
    window.addEventListener("storage", storageHandler);

    let firebaseRef = null;
    if (db) {
      firebaseRef = db.ref(`sessions/${currentSession}`);
      firebaseRef.on("value", (snapshot) => {
        if (snapshot.exists()) handler(snapshot.val());
      });
    }

    stopListening = () => {
      window.removeEventListener("storage", storageHandler);
      firebaseRef?.off();
      channel?.close();
      channel = null;
    };
  }

  function home() {
    cleanup();
    view(`<section class="shell"><div class="panel">
      <div class="brand">West SILC Powerhouse</div>
      <h1>Travel Training Scanner</h1>
      <p>Choose the screen you want to open on this device.</p>
      <div class="grid">
        <button class="choice" data-role="scanner"><span class="icon">▣</span><span>Learner scanner</span></button>
        <button class="choice" data-role="staff"><span class="icon">✓ ×</span><span>Staff controls</span></button>
      </div>
      <p class="small">Local test: open the learner scanner first, then open this file again in a second tab in the same browser.</p>
    </div></section>`);
    document.querySelectorAll("[data-role]").forEach((button) => {
      button.addEventListener("click", () => button.dataset.role === "scanner" ? chooseMode() : join());
    });
  }

  function chooseMode() {
    view(`<section class="shell"><div class="panel">
      <div class="brand">Learner screen</div>
      <h1>Choose simulator</h1>
      <div class="grid">
        <button class="choice" data-mode="bus"><span class="icon">🚌</span><span>Bus pass</span></button>
        <button class="choice" data-mode="payment"><span class="icon">◉</span><span>Contactless payment</span></button>
      </div>
      <div class="actions"><button class="secondary" id="back">Back</button></div>
    </div></section>`);
    document.querySelectorAll("[data-mode]").forEach((button) => {
      button.addEventListener("click", () => startScanner(button.dataset.mode));
    });
    document.querySelector("#back").addEventListener("click", home);
  }

  async function startScanner(mode) {
    currentMode = mode;
    currentSession = newCode();
    renderScanner();
    const connected = await initFirebase();
    if (!connected && firebaseConfigured()) {
      document.querySelector(".launch-card")?.insertAdjacentHTML(
        "beforeend",
        '<p class="error-box">Firebase could not connect. Check that Anonymous sign-in is enabled.</p>'
      );
    }
    send({ command: "ready", role: "scanner" });
    listen(handleScanner);
  }

  function renderScanner() {
    const bus = currentMode === "bus";
    view(`<section class="scanner ${bus ? "bus" : "payment"}" id="scanner">
      <img class="reader-img" src="${bus ? BUS_IMG : PAY_IMG}" alt="">
      <div id="dynamic">${bus ? busUi("READY – PRESENT PASS") : payUi("PRESENT CARD")}</div>
      <button class="exit" id="exit">Exit</button>
      <div class="corner-code">PAIR ${currentSession}</div>
      <div class="launch" id="launch"><div class="launch-card">
        <button id="launchBtn">Launch scanner</button>
        <p>Pairing code: <strong>${currentSession}</strong></p>
      </div></div>
    </section>`);
    document.querySelector("#exit").addEventListener("click", home);
    document.querySelector("#launchBtn").addEventListener("click", launchScanner, { once: true });
  }

  function launchScanner() {
    const root = document.documentElement;
    const request = root.requestFullscreen || root.webkitRequestFullscreen;
    try {
      const fullscreenResult = request?.call(root);
      fullscreenResult?.catch?.(() => {});
    } catch (error) {
      console.warn("Full screen is unavailable.", error);
    }
    try {
      const AudioClass = window.AudioContext || window.webkitAudioContext;
      if (AudioClass) {
        audio = audio || new AudioClass();
        audio.resume?.();
      }
    } catch (error) {
      console.warn("Sound is unavailable.", error);
    }
    document.querySelector("#launch")?.remove();
    try {
      screen.orientation?.lock?.("portrait").catch(() => {});
    } catch (error) {}
  }

  function busUi(message, state = "ready") {
    return `<div class="leds">
      <i class="led green ${["g1", "g2", "g3", "success"].includes(state) ? "on" : ""}"></i>
      <i class="led green ${["g2", "g3", "success"].includes(state) ? "on" : ""}"></i>
      <i class="led green ${["g3", "success"].includes(state) ? "on" : ""}"></i>
      <i class="led red ${state === "fail" ? "on" : ""}"></i>
    </div><div class="bus-display">${message}</div>`;
  }

  function payUi(message, state = "ready", amount = "") {
    const result = state === "success"
      ? '<div class="result-icon">✓</div>'
      : state === "fail"
        ? '<div class="result-icon">×</div>'
        : nfcSvg;
    return `<div class="payment-display ${state}">
      ${amount ? `<div class="pay-amount">£${amount}</div>` : ""}
      <div class="pay-message">${message}</div>
      ${result}
      <div class="progress">
        <i class="${["g1", "g2", "g3", "success"].includes(state) ? "on" : ""}"></i>
        <i class="${["g2", "g3", "success"].includes(state) ? "on" : ""}"></i>
        <i class="${["g3", "success"].includes(state) ? "on" : ""}"></i>
        <i class="${state === "success" ? "on" : ""}"></i>
      </div>
    </div>`;
  }

  function draw(message, state, amount = "") {
    const dynamic = document.querySelector("#dynamic");
    if (!dynamic) return;
    dynamic.innerHTML = currentMode === "bus" ? busUi(message, state) : payUi(message, state, amount);
  }

  function clearAnimationTimers() {
    stageTimers.forEach(clearTimeout);
    stageTimers = [];
    clearTimeout(resetTimer);
  }

  function readyMessage(amount = "") {
    draw(currentMode === "bus" ? "READY – PRESENT PASS" : "PRESENT CARD", "ready", amount);
  }

  function handleScanner(data) {
    if (!data || (data.mode && data.mode !== currentMode)) return;
    clearAnimationTimers();
    const amount = data.amount || "";
    if (data.command === "start") {
      draw(currentMode === "bus" ? "PLEASE HOLD" : "PLEASE HOLD CARD", "g1", amount);
      stageTimers.push(setTimeout(() => {
        draw(currentMode === "bus" ? "PLEASE HOLD" : "PROCESSING", "g2", amount);
      }, 450));
      stageTimers.push(setTimeout(() => {
        draw(currentMode === "bus" ? "PLEASE HOLD" : "PROCESSING", "g3", amount);
      }, 950));
    } else if (data.command === "success") {
      draw(currentMode === "bus" ? "PASS ACCEPTED" : "PAYMENT APPROVED", "success", amount);
      bleep(true);
      resetTimer = setTimeout(() => readyMessage(amount), RESET_TIME);
    } else if (data.command === "early") {
      draw(currentMode === "bus" ? "PASS NOT READ – TRY AGAIN" : "CARD NOT READ – TRY AGAIN", "fail", amount);
      bleep(false);
      resetTimer = setTimeout(() => readyMessage(amount), RESET_TIME);
    } else if (data.command === "reject") {
      draw(currentMode === "bus" ? "PASS NOT VALID – SEE DRIVER" : "PAYMENT DECLINED", "fail", amount);
      bleep(false);
      resetTimer = setTimeout(() => readyMessage(amount), RESET_TIME);
    }
  }

  function tone(frequency, start, duration, type = "sine", volume = 0.16) {
    if (!audio) return;
    const oscillator = audio.createOscillator();
    const gain = audio.createGain();
    oscillator.connect(gain);
    gain.connect(audio.destination);
    oscillator.frequency.value = frequency;
    oscillator.type = type;
    const begins = audio.currentTime + start;
    gain.gain.setValueAtTime(volume, begins);
    gain.gain.exponentialRampToValueAtTime(0.001, begins + duration);
    oscillator.start(begins);
    oscillator.stop(begins + duration);
  }

  function bleep(success) {
    if (!audio) return;
    if (currentMode === "payment") {
      if (success) {
        tone(1500, 0, 0.5, "sine", 0.14);
      } else {
        tone(750, 0, 0.2, "sine", 0.16);
        tone(750, 0.4, 0.2, "sine", 0.16);
      }
    } else if (success) {
      tone(2050, 0, 0.22, "square", 0.11);
    } else {
      tone(520, 0, 0.18, "square", 0.13);
      tone(520, 0.3, 0.18, "square", 0.13);
    }
  }

  function join() {
    view(`<section class="shell"><div class="panel">
      <div class="brand">Staff controls</div>
      <h1>Enter pairing code</h1>
      <p>Enter the four digits shown on the learner’s scanner.</p>
      <input class="code-input" id="joinCode" inputmode="numeric" maxlength="4" placeholder="0000" aria-label="Pairing code">
      <div class="actions">
        <button class="primary" id="connect">Connect</button>
        <button class="secondary" id="back">Back</button>
      </div>
      <p class="small" id="joinMsg"></p>
    </div></section>`);
    document.querySelector("#back").addEventListener("click", home);
    document.querySelector("#connect").addEventListener("click", connectController);
  }

  async function connectController() {
    const input = document.querySelector("#joinCode");
    const message = document.querySelector("#joinMsg");
    const connectButton = document.querySelector("#connect");
    if (!/^\d{4}$/.test(input.value)) {
      message.textContent = "Enter all four digits.";
      return;
    }
    currentSession = input.value;
    connectButton.classList.add("busy");
    message.textContent = firebaseConfigured() ? "Connecting…" : "Checking local scanner…";
    const connected = await initFirebase();
    if (!connected && firebaseConfigured()) {
      connectButton.classList.remove("busy");
      message.innerHTML = `<span class="error-box">Firebase could not connect. Enable Anonymous sign-in in Firebase Authentication. ${firebaseError}</span>`;
      return;
    }
    const localData = safeReadLocal();
    if (localData) {
      currentMode = localData.mode || "bus";
      renderController();
      return;
    }
    if (db) {
      try {
        const snapshot = await db.ref(`sessions/${currentSession}`).once("value");
        if (snapshot.exists()) {
          currentMode = snapshot.val().mode || "bus";
          renderController();
          return;
        }
      } catch (error) {
        console.error(error);
      }
    }
    connectButton.classList.remove("busy");
    message.innerHTML = firebaseConfigured()
      ? '<span class="error-box">No scanner was found with that code. Check the code and try again.</span>'
      : '<span class="error-box">No local scanner was found. Open the learner scanner in another tab first.</span>';
  }

  function renderController() {
    view(`<section class="shell"><div class="panel controller">
      <div class="brand">Staff controls</div>
      <h1>Connected</h1>
      <span class="status-pill online">Session ${currentSession}</span>
      <div class="mode-badge">${currentMode === "bus" ? "Bus pass" : "Contactless payment"}</div>
      ${currentMode === "payment" ? '<label for="amount">Payment amount (optional)</label><input class="amount-input" id="amount" inputmode="decimal" placeholder="e.g. 4.50">' : ""}
      <p>Press and hold the green tick until the progress bar completes. Releasing early will produce a “not read” message.</p>
      <div class="controller-grid">
        <button class="control accept" id="accept" aria-label="Hold to accept">✓</button>
        <button class="control reject" id="reject" aria-label="Reject">×</button>
      </div>
      <div class="hold-meter" id="meter"><span></span></div>
      <div class="actions"><button class="secondary" id="back">Disconnect</button></div>
    </div></section>`);
    listen(() => {});
    document.querySelector("#back").addEventListener("click", home);
    document.querySelector("#reject").addEventListener("click", () => {
      cancelHold(false);
      send({ command: "reject", amount: getAmount() });
    });
    const accept = document.querySelector("#accept");
    accept.addEventListener("pointerdown", startHold);
    accept.addEventListener("pointerup", endHold);
    accept.addEventListener("pointercancel", endHold);
    window.addEventListener("blur", endHold);
  }

  function getAmount() {
    const input = document.querySelector("#amount");
    if (!input || !input.value.trim()) return "";
    const value = Number(input.value.replace(",", "."));
    return Number.isFinite(value) && value >= 0 ? value.toFixed(2) : "";
  }

  function startHold(event) {
    event.preventDefault();
    if (holdTimer) return;
    const accept = document.querySelector("#accept");
    const meter = document.querySelector("#meter");
    accept.setPointerCapture?.(event.pointerId);
    accept.classList.add("pressed");
    meter.classList.add("running");
    send({ command: "start", amount: getAmount() });
    holdTimer = setTimeout(() => {
      holdTimer = null;
      send({ command: "success", amount: getAmount() });
      accept.classList.remove("pressed");
      meter.classList.remove("running");
    }, HOLD_TIME);
  }

  function endHold() {
    if (!holdTimer) return;
    clearTimeout(holdTimer);
    holdTimer = null;
    document.querySelector("#accept")?.classList.remove("pressed");
    document.querySelector("#meter")?.classList.remove("running");
    send({ command: "early", amount: getAmount() });
  }

  function cancelHold(sendFailure) {
    if (!holdTimer) return;
    clearTimeout(holdTimer);
    holdTimer = null;
    document.querySelector("#accept")?.classList.remove("pressed");
    document.querySelector("#meter")?.classList.remove("running");
    if (sendFailure) send({ command: "early", amount: getAmount() });
  }

  function cleanup() {
    cancelHold(false);
    clearAnimationTimers();
    stopCurrentListener();
    window.removeEventListener("blur", endHold);
    try {
      if (document.fullscreenElement) document.exitFullscreen?.();
    } catch (error) {}
  }

  window.addEventListener("error", (event) => {
    console.error("Application error:", event.error || event.message);
  });

  home();
})();
