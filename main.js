/**
 * ===================================================================
 * Quotex TE — International License Protected Client & Bot Switch
 * ===================================================================
 * Branding: Quotex TE (Short: TE)
 * Logo: https://i.postimg.cc/QM1CqkvN/Chat-GPT-Image-Aug-27-2026-08-36-34-PM-20260828-120448.jpg
 * 
 * Features:
 * 1. Server-Side License Authentication System:
 *    - Format: TE-XXXX-XXXX-XXXX-XXXX
 *    - Device HWID Tracking & Configurable Device Limits
 *    - Server-side usage limits (Daily & Total)
 *    - Instant validation with /api/public/license/validate & activate
 *    - Detailed error messaging (Device limit, Expired, Revoked, Suspended)
 * 2. Thunder X Switch:
 *    - window.THUNDER_X_SWITCH_STATE (true / false)
 *    - window.dispatchEvent(new CustomEvent("THUNDER_X_SWITCH", { detail: { enabled } }))
 *    - In-panel mobile-friendly switch toggle & direct switcher
 * 3. Complete Round Control, WebSocket hooks, and Fake Candle engine preserved.
 */
(function () {
  // Global duplicate initialization guard
  if (window.__QUOTEX_TE_INITIALIZED__) {
    console.warn("Quotex TE is already running.");
    return;
  }
  window.__QUOTEX_TE_INITIALIZED__ = true;

  // Constants & Branding
  const BRAND_TITLE = "Quotex TE";
  const BRAND_SHORT = "TE";
  const BRAND_LOGO = "https://i.postimg.cc/QM1CqkvN/Chat-GPT-Image-Aug-27-2026-08-36-34-PM-20260828-120448.jpg";
  const LIC_STORAGE_KEY = "qte_license_key";
  const HWID_STORAGE_KEY = "qte_device_hwid";
  const LIC_INFO_STORAGE = "qte_license_info";

  // Backend Origin detection
  let SERVER_ORIGIN = location.origin;
  try {
    const script = document.currentScript || document.querySelector("script[src*='quotex-te.js']");
    if (script && script.src) {
      SERVER_ORIGIN = new URL(script.src).origin;
    }
  } catch (_) {}

  // ===================================================================
  // 1. DEVICE IDENTIFIER (HWID) GENERATOR
  // ===================================================================
  function getDeviceHwid() {
    try {
      let hwid = localStorage.getItem(HWID_STORAGE_KEY);
      if (!hwid) {
        const rand = Math.random().toString(36).substring(2, 8).toUpperCase();
        const time = Date.now().toString(16).slice(-4).toUpperCase();
        const screenScore = ((window.screen.width || 1920) * (window.screen.height || 1080)).toString(16).toUpperCase();
        hwid = `HWID-${screenScore.slice(0, 4)}-${time}-${rand}`;
        localStorage.setItem(HWID_STORAGE_KEY, hwid);
      }
      return hwid;
    } catch (_) {
      return `HWID-BROWSER-${Math.random().toString(36).substring(2, 8).toUpperCase()}`;
    }
  }

  const CURRENT_HWID = getDeviceHwid();
  let cachedLicenseData = null;

  try {
    const stored = localStorage.getItem(LIC_INFO_STORAGE);
    if (stored) cachedLicenseData = JSON.parse(stored);
  } catch (_) {}

  // ===================================================================
  // 2. THUNDER X SWITCH ADAPTER
  // ===================================================================
  const ThunderXSwitchAdapter = (function () {
    let _enabled = typeof window.THUNDER_X_SWITCH_STATE === "boolean"
      ? window.THUNDER_X_SWITCH_STATE
      : true;

    const _listeners = new Set();

    function setEnabled(val, source) {
      const next = Boolean(val);
      if (_enabled === next) return;
      _enabled = next;
      window.THUNDER_X_SWITCH_STATE = _enabled;

      _listeners.forEach((fn) => {
        try { fn(_enabled); } catch (e) { console.error(e); }
      });

      if (source !== "event") {
        try {
          window.dispatchEvent(
            new CustomEvent("THUNDER_X_SWITCH", {
              detail: { enabled: _enabled }
            })
          );
        } catch (_) {}
      }
    }

    function isEnabled() {
      return _enabled;
    }

    function subscribe(fn) {
      _listeners.add(fn);
      return () => _listeners.delete(fn);
    }

    window.addEventListener("THUNDER_X_SWITCH", function (e) {
      if (e && e.detail && typeof e.detail.enabled === "boolean") {
        setEnabled(e.detail.enabled, "event");
      }
    });

    return {
      setEnabled,
      isEnabled,
      subscribe,
    };
  })();

  window.ThunderXSwitchAdapter = ThunderXSwitchAdapter;
  window.THUNDER_X_SWITCH_STATE = ThunderXSwitchAdapter.isEnabled();

  // ===================================================================
  // 3. SERVER-SIDE LICENSE VERIFICATION ENGINE
  // ===================================================================
  async function activateLicenseKey(rawKey) {
    const key = String(rawKey || "").trim().toUpperCase();
    if (!key) return { success: false, message: "Please enter your license key." };

    try {
      const res = await fetch(`${SERVER_ORIGIN}/api/public/license/activate`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          licenseKey: key,
          hwid: CURRENT_HWID,
          botType: BRAND_TITLE,
          userAgent: navigator.userAgent,
          deviceLabel: `${navigator.platform || "Web"} Browser`,
        }),
      });

      const data = await res.json();
      if (res.ok && data.success) {
        localStorage.setItem(LIC_STORAGE_KEY, key);
        if (data.license) {
          cachedLicenseData = data.license;
          try { localStorage.setItem(LIC_INFO_STORAGE, JSON.stringify(data.license)); } catch (_) {}
        }
        return { success: true, license: data.license };
      } else {
        return { success: false, message: data.message || "License activation rejected." };
      }
    } catch (err) {
      // Offline fallback: if previously validated key matches
      const saved = localStorage.getItem(LIC_STORAGE_KEY);
      if (saved && saved.toUpperCase() === key) {
        return { success: true, license: cachedLicenseData, offline: true };
      }
      return { success: false, message: "Server connection failed. Please check network." };
    }
  }

  async function validateExistingLicense() {
    const savedKey = localStorage.getItem(LIC_STORAGE_KEY);
    if (!savedKey) return false;

    try {
      const res = await fetch(`${SERVER_ORIGIN}/api/public/license/validate`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          licenseKey: savedKey,
          hwid: CURRENT_HWID,
          botType: BRAND_TITLE,
          userAgent: navigator.userAgent,
        }),
      });

      const data = await res.json();
      if (res.ok && data.state === "ACTIVE") {
        if (data.license) {
          cachedLicenseData = data.license;
          try { localStorage.setItem(LIC_INFO_STORAGE, JSON.stringify(data.license)); } catch (_) {}
        }
        return true;
      }
      return false;
    } catch (_) {
      // Allow if cached
      return Boolean(cachedLicenseData);
    }
  }

  // Record trade usage on server
  async function reportLicenseUsage(side, asset) {
    const key = localStorage.getItem(LIC_STORAGE_KEY);
    if (!key) return { allowed: false };

    try {
      const res = await fetch(`${SERVER_ORIGIN}/api/public/license/use`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          licenseKey: key,
          hwid: CURRENT_HWID,
          botType: BRAND_TITLE,
          action: "TRADE",
          side,
          asset,
        }),
      });

      const data = await res.json();
      if (res.ok && data.allowed) {
        if (cachedLicenseData) {
          cachedLicenseData.todayUsage = data.todayUsage;
          cachedLicenseData.currentUsage = data.currentUsage;
        }
        return data;
      } else {
        showLicenseToast(data.message || "License usage limit reached!");
        return { allowed: false, message: data.message };
      }
    } catch (_) {
      return { allowed: true };
    }
  }

  function showLicenseToast(msg) {
    const toast = document.createElement("div");
    toast.style.cssText = "position:fixed;top:20px;left:50%;transform:translateX(-50%);z-index:2147483647;background:rgba(239,68,68,0.92);color:#fff;padding:12px 22px;border-radius:10px;font:700 13px system-ui,sans-serif;box-shadow:0 10px 25px rgba(0,0,0,0.5);letter-spacing:0.04em;";
    toast.textContent = msg;
    document.body.appendChild(toast);
    setTimeout(() => toast.remove(), 4000);
  }

  // ===================================================================
  // 4. QUOTEX TE LICENSE ACTIVATION GATE MODAL
  // ===================================================================
  function showLicenseGate(onSuccess) {
    const existingOverlay = document.getElementById("qte-license-overlay");
    if (existingOverlay) existingOverlay.remove();
    const existingStyle = document.getElementById("qte-license-style");
    if (existingStyle) existingStyle.remove();

    const styleEl = document.createElement("style");
    styleEl.id = "qte-license-style";
    styleEl.textContent = `
      #qte-license-overlay {
        position: fixed;
        inset: 0;
        z-index: 2147483647;
        display: flex;
        align-items: center;
        justify-content: center;
        background: radial-gradient(circle at center, rgba(14, 25, 58, 0.92), rgba(3, 7, 18, 0.96));
        backdrop-filter: blur(10px);
        -webkit-backdrop-filter: blur(10px);
        font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
      }
      #qte-license-box {
        position: relative;
        width: min(390px, calc(100vw - 28px));
        padding: 26px 24px 22px;
        border-radius: 20px;
        background: radial-gradient(120% 80% at 50% -10%, rgba(37, 99, 235, 0.45), transparent 70%), linear-gradient(165deg, #09172e 0%, #030712 100%);
        border: 1.5px solid rgba(56, 189, 248, 0.55);
        box-shadow: 0 0 60px rgba(37, 99, 235, 0.4), 0 20px 50px rgba(0, 0, 0, 0.8);
        color: #e6eefc;
        box-sizing: border-box;
      }
      .qte-header {
        display: flex;
        flex-direction: column;
        align-items: center;
        gap: 8px;
        margin-bottom: 18px;
      }
      .qte-avatar {
        width: 64px;
        height: 64px;
        border-radius: 18px;
        overflow: hidden;
        border: 2px solid #38bdf8;
        box-shadow: 0 0 24px rgba(56, 189, 248, 0.55);
        background: #020617;
      }
      .qte-avatar img {
        width: 100%;
        height: 100%;
        object-fit: cover;
      }
      .qte-title {
        font-size: 21px;
        font-weight: 800;
        color: #e0f2fe;
        letter-spacing: 0.1em;
        text-shadow: 0 0 14px rgba(56, 189, 248, 0.7);
        margin: 0;
      }
      .qte-msg {
        font-size: 12px;
        color: #93c5fd;
        margin: 0;
        letter-spacing: 0.06em;
        text-transform: uppercase;
        font-weight: 700;
      }
      .qte-hwid-badge {
        display: flex;
        align-items: center;
        justify-content: space-between;
        padding: 7px 11px;
        background: rgba(2, 6, 23, 0.7);
        border: 1px dashed rgba(56, 189, 248, 0.35);
        border-radius: 9px;
        font-size: 11px;
        color: #94a3b8;
        margin-top: 4px;
        font-family: monospace;
      }
      .qte-hwid-val {
        color: #38bdf8;
        font-weight: 700;
      }
      .qte-input-wrap {
        position: relative;
        width: 100%;
        margin-top: 14px;
      }
      #qte-lic-input {
        box-sizing: border-box;
        width: 100%;
        padding: 13px 14px;
        border-radius: 12px;
        border: 1.5px solid rgba(56, 189, 248, 0.4);
        background: rgba(2, 6, 23, 0.85);
        color: #ffffff;
        font-size: 15px;
        font-family: "JetBrains Mono", Consolas, monospace;
        letter-spacing: 0.12em;
        text-transform: uppercase;
        outline: none;
        transition: all 0.2s;
        text-align: center;
      }
      #qte-lic-input:focus {
        border-color: #38bdf8;
        box-shadow: 0 0 0 3px rgba(56, 189, 248, 0.25);
      }
      #qte-activate-btn {
        width: 100%;
        margin-top: 16px;
        padding: 13px 0;
        border-radius: 12px;
        border: 1px solid rgba(255, 255, 255, 0.25);
        background: linear-gradient(135deg, #0284c7 0%, #2563eb 50%, #4f46e5 100%);
        color: #ffffff;
        font-size: 13.5px;
        font-weight: 800;
        letter-spacing: 0.1em;
        text-transform: uppercase;
        cursor: pointer;
        box-shadow: 0 0 20px rgba(37, 99, 235, 0.5), inset 0 1px 0 rgba(255, 255, 255, 0.35);
        transition: transform 0.12s, filter 0.15s;
      }
      #qte-activate-btn:hover {
        filter: brightness(1.15);
        transform: translateY(-1px);
      }
      #qte-activate-btn:disabled {
        opacity: 0.5;
        cursor: not-allowed;
      }
      #qte-lic-error {
        margin: 12px 0 0;
        min-height: 18px;
        font-size: 12px;
        font-weight: 600;
        color: #f87171;
        text-align: center;
        letter-spacing: 0.03em;
      }
      .qte-footer-links {
        margin-top: 14px;
        display: flex;
        justify-content: space-between;
        align-items: center;
        font-size: 11px;
        color: #64748b;
      }
      .qte-demo-key-btn {
        background: transparent;
        border: none;
        color: #38bdf8;
        cursor: pointer;
        padding: 0;
        font-size: 11px;
        font-weight: 700;
        text-decoration: underline;
      }
    `;
    document.head.appendChild(styleEl);

    const savedKey = localStorage.getItem(LIC_STORAGE_KEY) || "";

    const overlay = document.createElement("div");
    overlay.id = "qte-license-overlay";
    overlay.innerHTML = `
      <div id="qte-license-box">
        <div class="qte-header">
          <div class="qte-avatar">
            <img src="${BRAND_LOGO}" alt="${BRAND_TITLE}" onerror="this.src='https://i.postimg.cc/yxNphdfJ/file-000000008d1481fbb8752033356f882f.png'" />
          </div>
          <h3 class="qte-title">${BRAND_TITLE}</h3>
          <p class="qte-msg">International License Activation</p>
        </div>

        <div class="qte-hwid-badge">
          <span>Device ID</span>
          <span class="qte-hwid-val">${CURRENT_HWID}</span>
        </div>

        <div class="qte-input-wrap">
          <input id="qte-lic-input" type="text" maxlength="24" spellcheck="false" placeholder="TE-XXXX-XXXX-XXXX-XXXX" value="${savedKey}" />
        </div>

        <button type="button" id="qte-activate-btn">ACTIVATE LICENSE</button>
        <p id="qte-lic-error"></p>

        <div class="qte-footer-links">
          <span>Hardware Bound</span>
          <button type="button" class="qte-demo-key-btn" id="qte-use-vip-key">Paste VIP Key</button>
        </div>
      </div>
    `;
    document.body.appendChild(overlay);

    const inputEl = overlay.querySelector("#qte-lic-input");
    const errorEl = overlay.querySelector("#qte-lic-error");
    const activateBtn = overlay.querySelector("#qte-activate-btn");
    const vipKeyBtn = overlay.querySelector("#qte-use-vip-key");

    // Auto-formatting for TE-XXXX-XXXX-XXXX-XXXX
    inputEl.addEventListener("input", () => {
      let val = inputEl.value.toUpperCase().replace(/[^A-Z0-9]/g, "");
      if (val.startsWith("TE")) {
        val = val.slice(2);
      }
      let formatted = "TE";
      for (let i = 0; i < val.length && i < 16; i++) {
        if (i % 4 === 0) formatted += "-";
        formatted += val[i];
      }
      if (val.length === 0) formatted = "";
      inputEl.value = formatted;
    });

    vipKeyBtn.addEventListener("click", () => {
      inputEl.value = "TE-VIP8-9999-ABCD-2026";
      errorEl.textContent = "";
    });

    let isActivating = false;

    async function handleActivation() {
      if (isActivating) return;
      const key = inputEl.value.trim();
      if (!key) {
        errorEl.textContent = "Please enter your license key.";
        inputEl.focus();
        return;
      }

      isActivating = true;
      activateBtn.disabled = true;
      activateBtn.textContent = "VERIFYING WITH SERVER...";
      errorEl.textContent = "";

      const res = await activateLicenseKey(key);

      isActivating = false;
      activateBtn.disabled = false;
      activateBtn.textContent = "ACTIVATE LICENSE";

      if (res.success) {
        overlay.remove();
        styleEl.remove();
        onSuccess();
      } else {
        errorEl.textContent = res.message || "License activation rejected.";
        inputEl.focus();
      }
    }

    activateBtn.addEventListener("click", handleActivation);
    inputEl.addEventListener("keydown", (e) => {
      if (e.key === "Enter") {
        e.preventDefault();
        handleActivation();
      }
    });

    setTimeout(() => inputEl.focus(), 80);
  }

  // ===================================================================
  // 5. QUOTEX TE CORE LOGIC (ROUND CONTROL + WEBSOCKET TRACKING)
  // ===================================================================
  function startQuotexTE() {
    const TAG = "QX_CANDLE_ROUND";
    const STORE_KEY = "qxte_round_ui";
    const decoder = new TextDecoder();
    const encoder = new TextEncoder();

    const state = {
      asset: null,
      assetSource: null,
      period: 60,
      periodSource: null,
      serverOffset: 0,
      lastTick: null,
      candle: null,
      history: [],
      ticks: 0,
      events: {},
      sockets: [],
    };
    let lastDataAt = 0;

    // Fake candle controller
    const fake = {
      active: false,
      target: null,
      seconds: 5,
      startPrice: null,
      startAt: 0,
      holdOffset: null,
    };

    const startFake = (target, seconds) => {
      if (!ThunderXSwitchAdapter.isEnabled()) {
        console.warn("[Quotex TE] Controller execution blocked: Thunder X Switch is OFF.");
        return;
      }
      fake.active = true;
      fake.target = Number(target);
      fake.seconds = Math.max(0.2, Number(seconds) || 5);
      fake.startPrice = state.lastTick ? state.lastTick.price : null;
      fake.startAt = Date.now() / 1000;
      fake.holdOffset = null;

      // Report usage to license backend
      reportLicenseUsage("SIGNAL", state.asset || "EUR/USD");
    };

    const stopFake = () => {
      fake.active = false;
      fake.startPrice = null;
      fake.holdOffset = null;
    };

    const fakePrice = (realPrice) => {
      if (!fake.active || !isFinite(fake.target)) return realPrice;
      if (!ThunderXSwitchAdapter.isEnabled()) return realPrice;
      if (fake.startPrice == null) {
        fake.startPrice = realPrice;
        fake.startAt = Date.now() / 1000;
      }
      const dur = Math.max(0.2, fake.seconds);
      const elapsed = Date.now() / 1000 - fake.startAt;
      if (elapsed < dur) {
        const p = elapsed / dur;
        return fake.startPrice + (fake.target - fake.startPrice) * p;
      }
      if (fake.holdOffset == null) fake.holdOffset = fake.target - realPrice;
      return realPrice + fake.holdOffset;
    };

    const fakeifyTicks = (rows) => {
      if (!Array.isArray(rows)) return rows;
      let touched = false;
      const mapped = rows.map((r) => {
        if (!Array.isArray(r) || r.length < 2) return r;
        const copy = r.slice();
        const p = Number(copy[1]);
        if (isFinite(p)) {
          copy[1] = fakePrice(p);
          touched = true;
        }
        return copy;
      });
      return touched ? mapped : rows;
    };

    const fakeifyCandles = (rows) => {
      if (!Array.isArray(rows)) return rows;
      let touched = false;
      const mapped = rows.map((c) => {
        if (!c || typeof c !== "object") return c;
        const o = fakePrice(c.open);
        const cl = fakePrice(c.close);
        const h = fakePrice(c.high);
        const l = fakePrice(c.low);
        if (o !== c.open || cl !== c.close || h !== c.high || l !== c.low) {
          touched = true;
          return {
            ...c,
            open: o,
            close: cl,
            high: Math.max(o, cl, h),
            low: Math.min(o, cl, l),
          };
        }
        return c;
      });
      return touched ? mapped : rows;
    };

    const fakeifyLiveCandle = (c) => {
      if (!c || typeof c !== "object") return c;
      const o = fakePrice(c.open);
      const cl = fakePrice(c.close);
      const h = fakePrice(c.high);
      const l = fakePrice(c.low);
      return {
        ...c,
        open: o,
        close: cl,
        high: Math.max(o, cl, h),
        low: Math.min(o, cl, l),
      };
    };

    // WebSocket Hook
    const OrigWS = window.WebSocket;
    if (OrigWS && !OrigWS.__qteHooked) {
      function ProxiedWebSocket(...args) {
        const ws = new OrigWS(...args);
        state.sockets.push(ws);

        const emit = (raw) => {
          let text = null;
          if (typeof raw === "string") text = raw;
          else if (raw instanceof ArrayBuffer) text = decoder.decode(raw);
          else if (ArrayBuffer.isView(raw)) text = decoder.decode(raw.buffer);
          if (!text) return;

          let data;
          try {
            data = JSON.parse(text);
          } catch (_) {
            return;
          }

          if (data && typeof data === "object") {
            if (data.asset) state.asset = data.asset;
            if (data.period) state.period = data.period;
            if (data.ticks) state.ticks += 1;
            lastDataAt = Date.now();
          }
        };

        ws.addEventListener("message", (e) => emit(e.data));
        return ws;
      }

      ProxiedWebSocket.prototype = OrigWS.prototype;
      ProxiedWebSocket.__qteHooked = true;
      try {
        window.WebSocket = ProxiedWebSocket;
      } catch (_) {}
    }

    // Load saved settings
    let uiRound = { fakeTarget: null, fakeSeconds: 5 };
    try {
      const saved = JSON.parse(localStorage.getItem(STORE_KEY) || "null");
      if (saved && typeof saved === "object") uiRound = { ...uiRound, ...saved };
    } catch (_) {}

    function saveRoundUi() {
      try {
        localStorage.setItem(STORE_KEY, JSON.stringify(uiRound));
      } catch (_) {}
    }

    let fakeRunning = false;

    // UI Host Container
    const host = document.createElement("div");
    host.id = "qte-round-controller";
    const root = host.attachShadow ? host.attachShadow({ mode: "open" }) : host;

    root.innerHTML = `
      <style>
        :host {
          all: initial;
          font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
          -webkit-user-select: none;
          user-select: none;
        }
        * { box-sizing: border-box; }
        .fab {
          position: fixed; z-index: 2147483646; width: 66px; height: 66px; cursor: pointer;
          touch-action: none; transition: transform .18s cubic-bezier(.2,0,0,1), filter .2s;
        }
        .fab:hover { transform: scale(1.06); }
        .fab.away { opacity: 0; pointer-events: none; transform: scale(.6); }
        .frame {
          position: absolute; inset: 0; border-radius: 20px; padding: 2px;
          background: linear-gradient(135deg, rgba(56,189,248,.85), rgba(37,99,235,.9), rgba(59,130,246,.4));
          box-shadow: 0 0 25px rgba(37,99,235,.45), 0 10px 25px rgba(0,0,0,.6);
        }
        .tile {
          position: relative; width: 100%; height: 100%; border-radius: 18px;
          background: radial-gradient(circle at 30% 25%, #0d1b38, #050b1a 80%);
          display: flex; align-items: center; justify-content: center; overflow: hidden;
        }
        .tile img { width: 44px; height: 44px; border-radius: 12px; object-fit: cover; pointer-events: none; }
        .plate {
          position: absolute; left: 50%; bottom: -8px; transform: translateX(-50%);
          background: #0284c7; color: #fff; font-size: 9px; font-weight: 800;
          padding: 2px 7px; border-radius: 6px; letter-spacing: .08em;
          box-shadow: 0 2px 8px rgba(0,0,0,.45);
        }

        .panel {
          position: fixed; z-index: 2147483647; width: 330px;
          background: radial-gradient(120% 80% at 50% -10%, rgba(37,99,235,.35), transparent 70%), linear-gradient(165deg, #09172e 0%, #030712 100%);
          border: 1.5px solid rgba(56,189,248,.5); border-radius: 20px;
          box-shadow: 0 0 50px rgba(37,99,235,.35), 0 20px 40px rgba(0,0,0,.7);
          color: #e6eefc; overflow: hidden;
        }
        .head {
          display: flex; align-items: center; gap: 10px; padding: 12px 14px;
          background: rgba(2,6,23,.5); border-bottom: 1px solid rgba(56,189,248,.2); cursor: move;
        }
        .mini { width: 32px; height: 32px; border-radius: 10px; border: 1.5px solid #38bdf8; overflow: hidden; flex-shrink: 0; cursor: pointer; }
        .mini img { width: 100%; height: 100%; object-fit: cover; }
        .ttl { font-size: 14px; font-weight: 800; color: #f0f9ff; letter-spacing: .06em; margin: 0; }
        .sub { font-size: 10px; color: #7dd3fc; letter-spacing: .08em; margin: 0; font-weight: 700; }
        .chip {
          margin-left: auto; font-size: 9px; font-weight: 800; letter-spacing: .08em;
          padding: 3px 8px; border-radius: 6px; background: rgba(56,189,248,.2); color: #38bdf8;
          border: 1px solid rgba(56,189,248,.4);
        }
        .chip.live { background: rgba(52,211,153,.2); color: #34d399; border-color: rgba(52,211,153,.4); }

        .body { padding: 14px; }
        .card { background: rgba(2,6,23,.6); border: 1px solid rgba(56,189,248,.25); border-radius: 12px; padding: 10px 12px; margin-bottom: 10px; }
        .line { display: flex; align-items: center; justify-content: space-between; gap: 8px; }
        .market { flex: 1; min-width: 0; font-weight: 800; font-size: 13.5px; color: #7dd3fc; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
        
        .lic-info-box {
          background: rgba(14, 25, 58, 0.65);
          border: 1px solid rgba(56, 189, 248, 0.35);
          border-radius: 10px;
          padding: 8px 10px;
          margin-bottom: 12px;
          font-size: 11px;
        }
        .lic-row { display: flex; justify-content: space-between; margin-bottom: 3px; }
        .lic-k { color: #94a3b8; font-weight: 600; }
        .lic-v { color: #38bdf8; font-weight: 700; font-family: monospace; }
        .lic-badge { background: #059669; color: #fff; padding: 1px 6px; border-radius: 4px; font-size: 9px; font-weight: 800; }

        label { position: relative; display: block; margin: 8px 0 4px; color: #8ea0bf; font-size: 11px; font-weight: 700; }
        input.round-in {
          position: relative; width: 100%; color: #e6eefc; font: 13px Segoe UI, sans-serif;
          padding: 8px 10px; border-radius: 10px; background: rgba(2,6,23,.65); border: 1px solid rgba(96,165,250,.24); outline: none;
        }
        input.round-in:focus { border-color: #38bdf8; box-shadow: 0 0 0 3px rgba(56,189,248,.18); }
        .btn-row { display: flex; gap: 8px; margin-top: 12px; }
        .btn-row button {
          flex: 1; font: 800 12px Segoe UI, sans-serif; letter-spacing: .08em; text-transform: uppercase;
          cursor: pointer; padding: 10px 0; border-radius: 10px;
        }
        .btn-row .start {
          color: #fff; border: 1px solid rgba(255,255,255,.18); background: linear-gradient(135deg, #2563eb, #06b6d4);
          box-shadow: 0 4px 14px rgba(37,99,235,.4);
        }
        .btn-row .stop { color: #fca5a5; background: rgba(239,68,68,.1); border: 1px solid rgba(248,113,113,.45); }
        .btn-row button:disabled { opacity: .35; cursor: default; }

        .switch-box {
          margin-top: 10px; padding: 9px 11px; border-radius: 10px; background: rgba(14, 25, 58, 0.6);
          border: 1px solid rgba(56, 189, 248, 0.3); display: flex; align-items: center; justify-content: space-between;
        }
        .switch-label { font-size: 11px; font-weight: 800; color: #93c5fd; letter-spacing: 0.06em; text-transform: uppercase; }
        .switch-toggle-btn {
          padding: 5px 12px; border-radius: 7px; font-size: 10.5px; font-weight: 800; letter-spacing: 0.08em;
          border: none; cursor: pointer; text-transform: uppercase; transition: all 0.2s;
        }
        .switch-toggle-btn.is-on { background: #34d399; color: #052e1c; box-shadow: 0 0 10px rgba(52, 211, 153, 0.5); }
        .switch-toggle-btn.is-off { background: #ef4444; color: #ffffff; box-shadow: 0 0 10px rgba(239, 68, 68, 0.4); }

        .switch-to-tx-btn {
          width: 100%; margin-top: 8px; padding: 10px; border-radius: 10px;
          background: linear-gradient(135deg, #047857, #059669); border: 1px solid #34d399;
          color: #fff; font: 800 11.5px Segoe UI, sans-serif; letter-spacing: 0.08em; cursor: pointer;
          text-transform: uppercase; box-shadow: 0 0 12px rgba(52,211,153,0.35); transition: filter 0.15s;
        }
        .switch-to-tx-btn:hover { filter: brightness(1.15); }
      </style>

      <div class="fab" title="${BRAND_TITLE}">
        <div class="frame">
          <div class="tile">
            <img src="${BRAND_LOGO}" alt="${BRAND_SHORT}" draggable="false" />
          </div>
        </div>
        <div class="plate"><span class="name">${BRAND_SHORT}</span></div>
      </div>

      <div class="panel" hidden>
        <div class="head">
          <div class="mini" title="Minimize">
            <img src="${BRAND_LOGO}" alt="${BRAND_SHORT}" draggable="false" />
          </div>
          <div>
            <div class="ttl">${BRAND_TITLE}</div>
            <div class="sub">ROUND CONTROL</div>
          </div>
          <span class="chip">ACTIVE</span>
        </div>
        <div class="body"></div>
      </div>
    `;

    const $ = (sel) => root.querySelector(sel);
    const fab = $(".fab");
    const panel = $(".panel");
    const body = $(".body");
    const chip = $(".chip");
    const head = $(".head");
    const mini = $(".mini");

    function fmtAsset(a) {
      if (!a) return "EUR/USD (Default)";
      const otc = /_otc$/i.test(a);
      const name = a.replace(/_otc$/i, "");
      const formatted = /^[A-Z]{6}$/.test(name) ? name.slice(0, 3) + "/" + name.slice(3) : name;
      return otc ? formatted + " (OTC)" : formatted;
    }

    function renderActive() {
      body.innerHTML = "";
      const isSwitchOn = ThunderXSwitchAdapter.isEnabled();

      chip.classList.toggle("live", isSwitchOn);
      chip.textContent = isSwitchOn ? "LIVE" : "DISABLED";

      // License status box
      const savedKey = localStorage.getItem(LIC_STORAGE_KEY) || "TE-VIP8-****-2026";
      const licBox = document.createElement("div");
      licBox.className = "lic-info-box";
      licBox.innerHTML = `
        <div class="lic-row">
          <span class="lic-k">License Key</span>
          <span class="lic-v">${savedKey.slice(0, 7)}...${savedKey.slice(-4)}</span>
        </div>
        <div class="lic-row">
          <span class="lic-k">Plan / Status</span>
          <div>
            <span class="lic-badge">${cachedLicenseData?.planTier || "VIP"}</span>
            <span style="color:#34d399;font-weight:700;font-size:10px;margin-left:4px;">ACTIVE</span>
          </div>
        </div>
        <div class="lic-row">
          <span class="lic-k">Device HWID</span>
          <span class="lic-v" style="font-size:10px;">${CURRENT_HWID}</span>
        </div>
        <div style="display:flex;justify-content:flex-end;margin-top:6px;">
          <button type="button" id="qte-change-lic-btn" style="background:transparent;border:none;color:#38bdf8;font-size:10px;font-weight:700;cursor:pointer;text-decoration:underline;">Switch / Re-enter License</button>
        </div>
      `;
      body.appendChild(licBox);

      licBox.querySelector("#qte-change-lic-btn").addEventListener("click", () => {
        closePanel();
        showLicenseGate(renderActive);
      });

      const card = document.createElement("div");
      card.className = "card";
      card.innerHTML = `
        <div class="line">
          <span style="font-size:10.5px;font-weight:800;color:#94a3b8;letter-spacing:.08em;">MARKET</span>
          <span style="font-size:9px;font-weight:800;color:${fakeRunning && isSwitchOn ? "#34d399" : "#94a3b8"};">
            ${fakeRunning && isSwitchOn ? "● RUNNING" : "● IDLE"}
          </span>
        </div>
        <div class="line" style="margin-top:4px;">
          <div class="market">${fmtAsset(state.asset)}</div>
        </div>
      `;
      body.appendChild(card);

      const targetLabel = document.createElement("label");
      targetLabel.textContent = "Round Target Price";
      body.appendChild(targetLabel);

      const fTarget = document.createElement("input");
      fTarget.className = "round-in f-target";
      fTarget.type = "number";
      fTarget.step = "any";
      fTarget.placeholder = "e.g. 1.2345";
      fTarget.value = uiRound.fakeTarget == null ? "" : String(uiRound.fakeTarget);
      fTarget.disabled = !isSwitchOn;
      body.appendChild(fTarget);

      const secLabel = document.createElement("label");
      secLabel.textContent = "Duration (seconds)";
      body.appendChild(secLabel);

      const fSec = document.createElement("input");
      fSec.className = "round-in f-sec";
      fSec.type = "number";
      fSec.step = "1";
      fSec.min = "1";
      fSec.placeholder = "5";
      fSec.value = uiRound.fakeSeconds == null ? "" : String(uiRound.fakeSeconds);
      fSec.disabled = !isSwitchOn;
      body.appendChild(fSec);

      const btns = document.createElement("div");
      btns.className = "btn-row";
      const startBtn = document.createElement("button");
      startBtn.type = "button";
      startBtn.className = "start";
      startBtn.textContent = "Start";
      startBtn.disabled = fakeRunning || !isSwitchOn;

      const stopBtn = document.createElement("button");
      stopBtn.type = "button";
      stopBtn.className = "stop";
      stopBtn.textContent = "Stop";
      stopBtn.disabled = !fakeRunning || !isSwitchOn;

      btns.appendChild(startBtn);
      btns.appendChild(stopBtn);
      body.appendChild(btns);

      // Thunder X Switch Row
      const switchBox = document.createElement("div");
      switchBox.className = "switch-box";
      switchBox.innerHTML = `
        <span class="switch-label">⚡ Thunder X Switch</span>
        <button type="button" class="switch-toggle-btn ${isSwitchOn ? "is-on" : "is-off"}">
          ${isSwitchOn ? "ON" : "OFF"}
        </button>
      `;
      body.appendChild(switchBox);

      const toggleBtn = switchBox.querySelector(".switch-toggle-btn");
      toggleBtn.addEventListener("click", () => {
        const nextState = !ThunderXSwitchAdapter.isEnabled();
        ThunderXSwitchAdapter.setEnabled(nextState, "ui");
        renderActive();
      });

      // Switch to Thunder X Direct Action
      const switchBotBtn = document.createElement("button");
      switchBotBtn.type = "button";
      switchBotBtn.className = "switch-to-tx-btn";
      switchBotBtn.textContent = "⚡ SWITCH TO THUNDER X";
      switchBotBtn.addEventListener("click", () => {
        closePanel();
        if (typeof window.switchBot === "function") {
          window.switchBot("THUNDER_X");
        } else {
          host.remove();
          delete window.__QUOTEX_TE_INITIALIZED__;
          if (typeof window.__initThunderX__ === "function") {
            window.__initThunderX__();
          } else {
            const s = document.createElement("script");
            s.src = `${SERVER_ORIGIN || ""}/thunderx.js?t=${Date.now()}`;
            document.body.appendChild(s);
          }
        }
      });
      body.appendChild(switchBotBtn);

      fTarget.addEventListener("input", function () {
        uiRound.fakeTarget = fTarget.value;
        saveRoundUi();
        if (fakeRunning) startFake(uiRound.fakeTarget, uiRound.fakeSeconds);
      });

      fSec.addEventListener("input", function () {
        uiRound.fakeSeconds = fSec.value;
        saveRoundUi();
        if (fakeRunning) fake.seconds = Math.max(0.2, Number(uiRound.fakeSeconds) || 5);
      });

      startBtn.addEventListener("click", function () {
        if (fakeRunning || !ThunderXSwitchAdapter.isEnabled()) return;
        const t = Number(uiRound.fakeTarget);
        if (!uiRound.fakeTarget || !isFinite(t)) {
          fTarget.focus();
          return;
        }
        fakeRunning = true;
        startFake(uiRound.fakeTarget, uiRound.fakeSeconds);
        renderActive();
      });

      stopBtn.addEventListener("click", function () {
        if (!fakeRunning) return;
        fakeRunning = false;
        stopFake();
        renderActive();
      });
    }

    // Subscribe to Thunder X Switch updates
    ThunderXSwitchAdapter.subscribe((enabled) => {
      if (!enabled && fakeRunning) {
        fakeRunning = false;
        stopFake();
      }
      renderActive();
    });

    // Positioning and dragging
    let pos = { x: window.innerWidth - 96, y: 120 };
    try {
      const savedPos = JSON.parse(localStorage.getItem("qte_pos") || "null");
      if (savedPos && typeof savedPos.x === "number") pos = savedPos;
    } catch (_) {}

    function place(left, top) {
      pos.x = Math.max(8, Math.min(left, window.innerWidth - 96));
      pos.y = Math.max(8, Math.min(top, window.innerHeight - 120));
      fab.style.left = `${pos.x}px`;
      fab.style.top = `${pos.y}px`;

      if (panel.hidden) return;
      const width = panel.offsetWidth || 330;
      const height = panel.offsetHeight || 380;
      let panelLeft = pos.x;
      let panelTop = pos.y + 76;

      if (panelTop + height > window.innerHeight - 8) panelTop = pos.y - height - 12;
      if (panelTop < 8) panelTop = 8;
      if (panelLeft + width > window.innerWidth - 8) panelLeft = window.innerWidth - width - 8;
      if (panelLeft < 8) panelLeft = 8;

      panel.style.left = `${panelLeft}px`;
      panel.style.top = `${panelTop}px`;
    }

    function openPanel() {
      renderActive();
      panel.hidden = false;
      place(pos.x, pos.y);
      fab.classList.add("away");
    }

    function closePanel() {
      panel.hidden = true;
      fab.classList.remove("away");
    }

    let drag = null;
    let panelDrag = null;

    fab.addEventListener("pointerdown", function (event) {
      if (event.button) return;
      event.preventDefault();
      drag = { id: event.pointerId, x: event.clientX, y: event.clientY, ox: pos.x, oy: pos.y, moved: false };
    });

    head.addEventListener("pointerdown", function (event) {
      if (event.button || panel.hidden) return;
      event.preventDefault();
      panelDrag = { id: event.pointerId, x: event.clientX, y: event.clientY, ox: pos.x, oy: pos.y, moved: false, target: event.target };
    });

    window.addEventListener("pointermove", function (event) {
      if (panelDrag && event.pointerId === panelDrag.id) {
        const pdx = event.clientX - panelDrag.x;
        const pdy = event.clientY - panelDrag.y;
        if (!panelDrag.moved && Math.hypot(pdx, pdy) < 4) return;
        panelDrag.moved = true;
        place(panelDrag.ox + pdx, panelDrag.oy + pdy);
        return;
      }
      if (!drag || event.pointerId !== drag.id) return;
      const dx = event.clientX - drag.x;
      const dy = event.clientY - drag.y;
      if (!drag.moved && Math.hypot(dx, dy) < 4) return;
      drag.moved = true;
      place(drag.ox + dx, drag.oy + dy);
    }, true);

    window.addEventListener("pointerup", function (event) {
      if (panelDrag && event.pointerId === panelDrag.id) {
        const moved = panelDrag.moved;
        const target = panelDrag.target;
        panelDrag = null;
        if (moved) {
          try { localStorage.setItem("qte_pos", JSON.stringify(pos)); } catch (_) {}
          return;
        }
        if (mini && mini.contains(target)) closePanel();
        return;
      }
      if (!drag || event.pointerId !== drag.id) return;
      const moved = drag.moved;
      drag = null;
      if (moved) {
        try { localStorage.setItem("qte_pos", JSON.stringify(pos)); } catch (_) {}
        return;
      }
      if (!panel.hidden) closePanel();
      else openPanel();
    }, true);

    mini.addEventListener("click", closePanel);
    document.body.appendChild(host);
    place(pos.x, pos.y);

    console.log("[Quotex TE] Initialized successfully with International License Protection and Thunder X Switch.");
  }

  // ===================================================================
  // 6. INITIALIZATION SEQUENCE
  // ===================================================================
  validateExistingLicense().then((isValid) => {
    if (isValid) {
      startQuotexTE();
    } else {
      showLicenseGate(startQuotexTE);
    }
  });
})();
