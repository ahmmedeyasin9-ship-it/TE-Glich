/* =====================================================================
   QUOTEX ZR PRO — বুকমার্ক সংস্করণ
   ---------------------------------------------------------------------
   Read-only সংস্করণ: Trader ID / License verification সরানো হয়েছে।
   কোনো Buy/Sell click আটকানো হয় না; শুধু market/socket data পর্যবেক্ষণ করে।

   পপআপ: Candle time (সেকেন্ড, ডিফল্ট 5) → Apply।
   socket থেকে শুধু পড়া হয় — চার্ট, ব্যালেন্স বা ট্রেডের ফলাফল বদলানো হয় না।

   বন্ধ: qxUninstall()
   ===================================================================== */
(() => {
  "use strict";
  if (window.__qxCandleConsole) return;
  window.__qxCandleConsole = true;

  const STORE_KEY = "qxCandleRoundUi";
  const decoder = new TextDecoder();
  let qxEngineLive = false;

  /* ===================================================================
     অংশ ১ — ডেটা ট্র্যাকিং (শুধু পড়া) + WS হুক
     =================================================================== */

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

  const countEvent = (name) => {
    state.events[name] = (state.events[name] || 0) + 1;
  };

  const setAsset = (asset, source) => {
    if (!asset || typeof asset !== "string") return;
    if (state.asset !== asset) {
      state.asset = asset;
      state.candle = null;
      state.history = [];
    }
    state.assetSource = source;
  };

  const setPeriod = (period, source) => {
    const p = Number(period);
    if (!p || p < 1 || p > 86400) return;
    if (state.periodSource === "user" && source !== "user") return;
    if (state.period !== p) {
      state.period = p;
      state.candle = null;
      state.history = [];
    }
    state.periodSource = source;
  };

  const onTick = (asset, time, price) => {
    if (typeof asset !== "string" || !isFinite(time) || !isFinite(price)) return;
    if (!state.asset) setAsset(asset, "first-tick");
    if (asset !== state.asset) return;

    state.ticks++;
    state.serverOffset = time - Date.now() / 1000;
    state.lastTick = { time, price };
    lastDataAt = Date.now();

    const start = Math.floor(time / state.period) * state.period;
    const c = state.candle;
    if (!c || c.start !== start) {
      if (c && start > c.start) {
        state.history.push({ start: c.start, open: c.open, close: c.close, high: c.high, low: c.low });
        if (state.history.length > 50) state.history.shift();
      }
      state.candle = { start, open: price, high: price, low: price, close: price, fromHistory: false };
    } else {
      c.close = price;
      if (price > c.high) c.high = price;
      if (price < c.low) c.low = price;
    }
  };

  const onHistory = (obj) => {
    if (!obj || typeof obj !== "object") return;
    if (obj.asset && !state.asset) setAsset(obj.asset, "history");
    if (obj.asset && obj.asset !== state.asset) return;
    if (obj.period) {
      setPeriod(obj.period, "history");
      if (Number(obj.period) !== state.period) return;
    }
    const candles = Array.isArray(obj.candles) ? obj.candles : null;
    if (!candles || !candles.length) return;

    const parsed = candles
      .filter((k) => Array.isArray(k) && k.length >= 5)
      .map((k) => ({ start: Number(k[0]), open: Number(k[1]), close: Number(k[2]), high: Number(k[3]), low: Number(k[4]) }))
      .filter((k) => isFinite(k.start) && isFinite(k.open))
      .sort((a, b) => a.start - b.start);
    if (!parsed.length) return;

    const last = parsed[parsed.length - 1];
    const nowServer = Date.now() / 1000 + state.serverOffset;
    const currentStart = Math.floor(nowServer / state.period) * state.period;

    const closed = parsed.filter((k) => k.start < currentStart);
    state.history = closed.slice(-50);
    if (last.start === currentStart) {
      state.candle = { ...last, fromHistory: true };
    }
    lastDataAt = Date.now();
  };

  const handlePayload = (data) => {
    if (Array.isArray(data)) {
      let handled = false;
      for (const row of data) {
        if (Array.isArray(row) && row.length >= 3 && typeof row[0] === "string" && typeof row[1] === "number" && typeof row[2] === "number") {
          onTick(row[0], row[1], row[2]);
          handled = true;
        }
      }
      if (handled) countEvent("quotes/stream");
      return;
    }
    if (data && typeof data === "object") {
      if (Array.isArray(data.candles)) {
        countEvent("history(candles)");
        onHistory(data);
      }
    }
  };

  const parseSocketIoText = (text) => {
    const m = /^\d+(?:-)?(?:\/[^,]*,)?(\d*)(\[.*)$/s.exec(text);
    if (!m) return null;
    try {
      const arr = JSON.parse(m[2]);
      if (Array.isArray(arr) && typeof arr[0] === "string") return { event: arr[0], data: arr[1] };
    } catch (_) {}
    return null;
  };

  const handleIncomingText = (text) => {
    if (text.length > 2 && (text[0] === "[" || text[0] === "{")) {
      try {
        handlePayload(JSON.parse(text));
      } catch (_) {}
      return;
    }
    const msg = parseSocketIoText(text);
    if (!msg) return;
    countEvent(msg.event);
    const d = msg.data;
    if (d && d._placeholder) return;
    if (msg.event === "quotes/stream") handlePayload(d);
    else if (/history/i.test(msg.event) || (d && Array.isArray(d.candles))) onHistory(d);
    else if (msg.event === "instruments/update" && d && d.asset) {
      setAsset(d.asset, "server");
      if (d.period) setPeriod(d.period, "server");
    }
  };

  const handleIncomingBinary = (buf) => {
    let bytes = new Uint8Array(buf);
    if (bytes.length && bytes[0] < 10) bytes = bytes.subarray(1);
    const text = decoder.decode(bytes);
    try {
      handlePayload(JSON.parse(text));
    } catch (_) {
      handleIncomingText(text);
    }
  };

  const handleOutgoing = (data) => {
    if (typeof data !== "string") return;
    const msg = parseSocketIoText(data);
    if (!msg) return;
    const d = msg.data;
    countEvent("→ " + msg.event);
    switch (msg.event) {
      case "instruments/update":
      case "chart_notification/get":
      case "history/load/line":
      case "instruments/follow":
        if (d && typeof d === "object") {
          if (d.asset) setAsset(d.asset, "client:" + msg.event);
          if (d.period) setPeriod(d.period, "client:" + msg.event);
        }
        break;
      case "depth/follow":
        if (typeof d === "string") setAsset(d, "client:depth/follow");
        break;
    }
  };

  const trackState = (raw) => {
    try {
      if (typeof raw === "string") handleIncomingText(raw);
      else if (raw instanceof ArrayBuffer) handleIncomingBinary(raw);
      else if (raw instanceof Blob) raw.arrayBuffer().then(handleIncomingBinary).catch(() => {});
    } catch (_) {}
  };

  const noteSocket = (url) => {
    try {
      const u = String(url).split("?")[0];
      if (state.sockets.indexOf(u) < 0) {
        state.sockets.push(u);
        if (state.sockets.length > 5) state.sockets.shift();
      }
    } catch (_) {}
  };

  /* --- ট্রেড বন্ধ (s_orders/close) — আসল জয়ের profit পড়ে orb দেখানো --- */
  const CLOSED_MAX = 500;
  const closedDeals = new Set();
  /** socket → placeholder-এর পরে আসা binary frame কোন event-এর */
  const binQueue = new WeakMap();

  const onOrdersClosed = (d) => {
    if (!d || !Array.isArray(d.deals)) return;
    let won = 0;
    for (const deal of d.deals) {
      if (!deal || deal.id == null) continue;
      const id = String(deal.id);
      if (closedDeals.has(id)) continue;
      closedDeals.add(id);
      if (closedDeals.size > CLOSED_MAX) closedDeals.delete(closedDeals.values().next().value);
      const profit = Number(deal.profit);
      if (isFinite(profit) && profit > 0.004) won += profit;
    }
    if (won > 0) showProfitOrb(Math.round(won * 1e4) / 1e4);
  };

  const trackDeals = (ws, raw) => {
    if (typeof raw === "string") {
      const ph = /^45(\d+)-(?:\/[^,]*,)?\d*\["([^"]+)"/.exec(raw);
      if (ph) {
        let q = binQueue.get(ws);
        if (!q) binQueue.set(ws, (q = []));
        for (let i = 0; i < Number(ph[1]); i++) q.push(ph[2]);
        return;
      }
      if (raw.indexOf("s_orders/close") < 0) return;
      const msg = parseSocketIoText(raw);
      if (msg && msg.event === "s_orders/close") onOrdersClosed(msg.data);
      return;
    }
    if (!(raw instanceof ArrayBuffer)) return;
    const q = binQueue.get(ws);
    const ev = q && q.length ? q.shift() : null;
    if (ev !== "s_orders/close") return;
    const bytes = new Uint8Array(raw);
    const off = bytes.length && bytes[0] < 10 ? 1 : 0;
    try {
      onOrdersClosed(JSON.parse(decoder.decode(bytes.subarray(off))));
    } catch (_) {}
  };

  /* --- হুক: চালু থাকা socket-ও ধরতে MessageEvent.data + send প্যাচ করি --- */
  const PROC = Symbol("qxProcessed");
  const nativeDataDesc = Object.getOwnPropertyDescriptor(MessageEvent.prototype, "data");
  const nativeGetData = nativeDataDesc.get;

  Object.defineProperty(MessageEvent.prototype, "data", {
    configurable: true,
    enumerable: nativeDataDesc.enumerable,
    get() {
      const raw = nativeGetData.call(this);
      // শুধু WebSocket থেকে আসা message ধরি (postMessage/worker বাদ)
      const tgt = this.currentTarget || this.target;
      if (!(tgt instanceof WebSocket) || !qxEngineLive) return raw;
      if (!this[PROC]) {
        this[PROC] = true;
        noteSocket(tgt.url);
        trackState(raw);
        try {
          trackDeals(tgt, raw);
        } catch (_) {}
      }
      return raw;
    },
  });

  const nativeSend = WebSocket.prototype.send;
  WebSocket.prototype.send = function (data) {
    try {
      handleOutgoing(data);
    } catch (_) {}
    return nativeSend.apply(this, arguments);
  };

  // ভবিষ্যতে খোলা নতুন socket-ও যেন তালিকায় আসে
  const NativeWS = window.WebSocket;
  const HookedWS = new Proxy(NativeWS, {
    construct(target, args) {
      const ws = new target(...args);
      noteSocket(args[0]);
      return ws;
    },
  });
  window.WebSocket = HookedWS;

  /* ===================================================================
     অংশ ২ — UI প্যানেল (Shadow DOM)
     =================================================================== */

  const APP_TITLE = "QUOTEX ZR PRO";
  const SITE_ORIGIN = "https://quotexzrpro.netlify.app";
  const LOGO_URL = SITE_ORIGIN + "/logo-256.png";

  /* ===================================================================
     অংশ ১.৫ — কোনো Trader ID / License Verification নেই
     -------------------------------------------------------------------
     এই সংস্করণ শুধু market/socket data পর্যবেক্ষণ করে।
     Buy/Sell বাটনে কোনো listener বা বাধা যোগ করা হয় না।
     =================================================================== */

  const DEFAULT_CANDLE_SECONDS = 5;
  // পপআপের রঙ — সাইটের লোগোর রঙে। RGB মানগুলো "r, g, b" আকারে (rgba-তে ব্যবহারের জন্য)।
  const THEME = {
    accent: "30, 144, 255",
    accent2: "56, 189, 248",
    accent3: "29, 78, 216",
    cardTop: "10, 26, 64",
    cardBottom: "3, 8, 24",
    overlay: "2, 6, 18",
    field: "2, 14, 36",
    text: "#eaf4ff",
    title: "#ffffff, #7dd3fc 50%, #3b9bff",
    label: "#5cc8ff",
    sub: "#7a8fb0",
    hint: "#8fb0d6",
    button: "#38bdf8, #1e90ff 50%, #1d4ed8",
    buttonText: "#ffffff",
  };

  let ui = {
    candleSeconds: DEFAULT_CANDLE_SECONDS,
  };

  const loadUi = () => {
    try {
      const raw = localStorage.getItem(STORE_KEY);
      if (raw) ui = { ...ui, ...JSON.parse(raw) };
    } catch (_) {}
  };
  const save = () => {
    try {
      localStorage.setItem(STORE_KEY, JSON.stringify(ui));
    } catch (_) {}
  };

  const old = document.getElementById("qx-candle-round-host");
  if (old) old.remove();

  const host = document.createElement("div");
  host.id = "qx-candle-round-host";
  const root = host.attachShadow({ mode: "open" });
  root.innerHTML = `
    <style>
      @import url("https://fonts.googleapis.com/css2?family=Orbitron:wght@600;700;800&family=Sora:wght@400;500;600;700&display=swap");
      :host { all: initial; }
      .pro-overlay {
        --a: ${THEME.accent}; --a2: ${THEME.accent2}; --a3: ${THEME.accent3};
        --card1: ${THEME.cardTop}; --card2: ${THEME.cardBottom}; --ov: ${THEME.overlay}; --fld: ${THEME.field};
      }
      * { box-sizing: border-box; }
      @keyframes proPulse {
        0%, 100% { opacity: .45; transform: scale(1); }
        50% { opacity: .85; transform: scale(1.03); }
      }
      @keyframes proScan {
        0% { transform: translateX(-120%) rotate(12deg); }
        100% { transform: translateX(220%) rotate(12deg); }
      }
      .pro-overlay {
        position: fixed; inset: 0; z-index: 2147483647;
        display: flex; align-items: center; justify-content: center; padding: 20px;
        background: radial-gradient(ellipse 80% 60% at 50% 0%, rgba(var(--a), .18), transparent 55%),
          radial-gradient(ellipse 60% 50% at 80% 100%, rgba(var(--a3), .12), transparent 50%),
          rgba(var(--ov), .88);
        backdrop-filter: blur(14px);
        font-family: "Sora", system-ui, sans-serif;
        transition: opacity .35s ease, visibility .35s ease;
      }
      .pro-overlay.out { opacity: 0; visibility: hidden; pointer-events: none; }
      .pro-card {
        position: relative; width: min(100%, 380px); padding: 28px 26px 24px;
        border-radius: 22px; overflow: hidden; text-align: center; color: ${THEME.text};
        border: 1.5px solid transparent;
        background: linear-gradient(165deg, rgba(var(--card1), .97) 0%, rgba(var(--card2), .98) 100%) padding-box,
          linear-gradient(135deg, rgb(var(--a)), rgb(var(--a2)) 50%, rgb(var(--a3))) border-box;
        box-shadow: 0 0 0 1px rgba(255,255,255,.04) inset,
          0 24px 80px rgba(0, 0, 0, .55),
          0 0 48px rgba(var(--a), .22);
      }
      .pro-card::before {
        content: ""; position: absolute; inset: -40%; pointer-events: none;
        background: linear-gradient(105deg, transparent 40%, rgba(var(--a), .08) 50%, transparent 60%);
        animation: proScan 4.5s ease-in-out infinite;
      }
      .pro-ring {
        position: absolute; top: -60px; left: 50%; width: 200px; height: 200px;
        margin-left: -100px; border-radius: 50%;
        border: 1px solid rgba(var(--a), .25);
        box-shadow: 0 0 40px rgba(var(--a), .2);
        animation: proPulse 3s ease-in-out infinite;
      }
      .pro-logo {
        position: relative; width: 88px; height: 88px; margin: 0 auto 12px;
        border-radius: 50%; object-fit: cover;
        border: 2px solid rgba(var(--a), .6);
        box-shadow: 0 0 0 4px rgba(var(--a), .1), 0 0 24px rgba(var(--a), .45);
      }
      .pro-title {
        position: relative; margin: 0;
        font: 800 1.15rem/1.2 "Orbitron", sans-serif;
        letter-spacing: .06em; text-transform: uppercase;
        background: linear-gradient(90deg, ${THEME.title});
        -webkit-background-clip: text; background-clip: text; color: transparent;
        text-shadow: 0 0 30px rgba(var(--a), .3);
      }
      .pro-sub {
        position: relative; margin: 6px 0 22px; font-size: 12px; color: ${THEME.sub};
        letter-spacing: .04em;
      }
      .pro-step { position: relative; text-align: left; }
      .pro-step[hidden] { display: none; }
      .pro-label {
        display: block; font-size: 11px; font-weight: 600; text-transform: uppercase;
        letter-spacing: .08em; color: ${THEME.label}; margin-bottom: 8px;
      }
      .pro-hint { font-size: 12px; color: ${THEME.hint}; margin: -4px 0 10px; line-height: 1.45; }
      .pro-field {
        width: 100%; height: 48px; padding: 0 14px; border-radius: 12px;
        border: 1.5px solid rgba(var(--a), .45); background: rgba(var(--fld), .85);
        color: ${THEME.text}; font-size: 15px; font-family: inherit;
        font-variant-numeric: tabular-nums;
        transition: border-color .2s, box-shadow .2s;
      }
      .pro-field:focus {
        outline: none; border-color: rgb(var(--a));
        box-shadow: 0 0 0 4px rgba(var(--a), .18);
      }
      .pro-field::-webkit-outer-spin-button,
      .pro-field::-webkit-inner-spin-button { -webkit-appearance: none; margin: 0; }
      .pro-btn {
        width: 100%; margin-top: 14px; height: 48px; border: none; border-radius: 12px;
        cursor: pointer; font: 700 14px "Sora", sans-serif; letter-spacing: .04em;
        color: ${THEME.buttonText};
        background: linear-gradient(135deg, ${THEME.button});
        box-shadow: 0 10px 28px rgba(var(--a), .45);
        transition: transform .15s, filter .15s;
      }
      .pro-btn:hover { filter: brightness(1.08); transform: translateY(-1px); }
      .pro-btn:active { transform: translateY(0); }
      .pro-err {
        margin: 10px 0 0; font-size: 12px; color: #fca5a5; text-align: center;
      }
      .pro-err[hidden] { display: none; }
      /* অ্যান্ড্রয়েডে চলমান চার্টের ওপর backdrop-filter ঝলকায় — মোবাইলে blur ছাড়া গাঢ় পর্দা */
      @media (max-width: 767px), (pointer: coarse) {
        .pro-overlay { backdrop-filter: none; background-color: rgba(var(--ov), .95); }
      }
    </style>
    <div class="pro-overlay">
      <div class="pro-card">
        <div class="pro-ring"></div>
        <img class="pro-logo" alt="${APP_TITLE}" />
        <h1 class="pro-title">${APP_TITLE}</h1>
        <p class="pro-sub">Secure candle engine · access verified</p>
        <div class="pro-step pro-step-candle">
          <label class="pro-label">Candle time set</label>
          <p class="pro-hint">Chart candle interval in seconds (e.g. 5, 10, 60).</p>
          <input class="pro-field pro-candle" type="number" min="1" max="3600" step="1" placeholder="${DEFAULT_CANDLE_SECONDS}" />
          <button type="button" class="pro-btn pro-apply">Apply &amp; Save</button>
          <p class="pro-err pro-err-candle" hidden></p>
        </div>
      </div>
    </div>`;

  const $ = (s) => root.querySelector(s);

  const proLogo = $(".pro-logo");
  if (proLogo) {
    proLogo.addEventListener("error", () => {
      proLogo.style.display = "none";
    });
    proLogo.src = LOGO_URL;
  }

  /* ===================================================================
     Apple Intelligence / Siri-স্টাইল স্ক্রিন-কিনারার আলো — বট চালু থাকলে
     -------------------------------------------------------------------
     চার কিনারায় চারটে সরু ফালি; প্রতিটায় গোলাপি → বেগুনি → নীল → সায়ান →
     কোরাল রঙের ট্র্যাক ঘড়ির কাঁটার দিকে থামাহীন দৌড়ায়। চলা শুধু transform-এ,
     জ্বলা-কমা শুধু opacity-তে। ক্লিক আটকায় না; reduced motion-এ খুব ধীর।
     =================================================================== */
  const AI_GLOW_ID = "qx-ai-glow";
  const AI_GLOW_STYLE_ID = "qx-ai-glow-style";
  const ensureAiGlowStyle = () => {
    if (document.getElementById(AI_GLOW_STYLE_ID)) return;
    const st = document.createElement("style");
    st.id = AI_GLOW_STYLE_ID;
    const G = "#" + AI_GLOW_ID;
    const HUES = "#ff3ea5,#b04dff,#2f7bff,#22d3ee,#ff5a6e,#ff3ea5";
    const FADE = "#000 0%,rgba(0,0,0,.7) 25%,rgba(0,0,0,.3) 60%,transparent 100%";
    const edge = (cls, dir) =>
      G + " ." + cls + "{-webkit-mask-image:linear-gradient(" + dir + "," + FADE + ");mask-image:linear-gradient(" + dir + "," + FADE + ")}";
    st.textContent = [
      G + "{position:fixed;inset:0;pointer-events:none;z-index:2147483646;opacity:0;" +
        "transition:opacity .35s ease;contain:strict;--t:clamp(8px,1.4vmin,13px)}",
      G + ".on{opacity:1}",
      "@media (pointer:coarse),(max-width:767px){" + G + "{--t:clamp(11px,3vmin,16px)}" + G + " .h{display:none}}",
      G + " .s{position:absolute;inset:0}",
      G + " .c{animation:qxAiBreath 3.2s ease-in-out infinite}",
      G + " .h{--t:clamp(18px,3vmin,28px);filter:blur(5px);animation:qxAiHaze 4.4s ease-in-out infinite}",
      G + " .s>b{position:absolute;display:block;overflow:hidden}",
      G + " .t{top:0;left:0;right:0;height:var(--t)}",
      G + " .b{bottom:0;left:0;right:0;height:var(--t)}",
      G + " .rt{top:0;bottom:0;right:0;width:var(--t)}",
      G + " .lf{top:0;bottom:0;left:0;width:var(--t)}",
      edge("t", "180deg"), edge("b", "0deg"), edge("rt", "270deg"), edge("lf", "90deg"),
      G + " .s>b>i{position:absolute;display:block;will-change:transform}",
      G + " .t>i," + G + " .b>i{top:0;bottom:0;left:0;width:200%;" +
        "background:linear-gradient(90deg," + HUES + ") 0 0/50% 100% repeat-x}",
      G + " .rt>i," + G + " .lf>i{left:0;right:0;top:0;height:200%;" +
        "background:linear-gradient(180deg," + HUES + ") 0 0/100% 50% repeat-y}",
      G + " .t>i{animation:qxAiRunX 6s linear infinite reverse}",
      G + " .b>i{animation:qxAiRunX 6s linear infinite}",
      G + " .rt>i{animation:qxAiRunY 6s linear infinite reverse}",
      G + " .lf>i{animation:qxAiRunY 6s linear infinite}",
      G + " .h>b>i{animation-duration:9s}",
      "@keyframes qxAiRunX{from{transform:translateX(0)}to{transform:translateX(-50%)}}",
      "@keyframes qxAiRunY{from{transform:translateY(0)}to{transform:translateY(-50%)}}",
      "@keyframes qxAiBreath{0%,100%{opacity:.85}50%{opacity:1}}",
      "@keyframes qxAiHaze{0%,100%{opacity:.35}50%{opacity:.6}}",
    ].join("\n");
    (document.head || document.documentElement).appendChild(st);
  };
  const setAiGlow = (on) => {
    let el = document.getElementById(AI_GLOW_ID);
    if (!on) {
      if (el) el.classList.remove("on");
      return;
    }
    ensureAiGlowStyle();
    if (!el) {
      el = document.createElement("div");
      el.id = AI_GLOW_ID;
      el.setAttribute("aria-hidden", "true");
      const strips = '<b class="t"><i></i></b><b class="rt"><i></i></b><b class="b"><i></i></b><b class="lf"><i></i></b>';
      el.innerHTML = '<div class="s h">' + strips + '</div><div class="s c">' + strips + "</div>";
      document.documentElement.appendChild(el);
    }
    requestAnimationFrame(() => el.classList.add("on"));
  };
  const removeAiGlow = () => {
    const el = document.getElementById(AI_GLOW_ID);
    if (el) el.remove();
    const st = document.getElementById(AI_GLOW_STYLE_ID);
    if (st) st.remove();
  };

  /* ===================================================================
     Profit হলে স্ক্রিনের মাঝের একটু নিচে সবুজ profit orb + "Profit +$X"
     -------------------------------------------------------------------
     চকচকে সবুজ গোলক, ভেতরে সাদা ↑ তীর আস্তে ওঠানামা করে, নিচ থেকে
     সোনালি কণা উঠে মিলিয়ে যায়, মাঝে মাঝে আলোর ঝলক পার হয়; গোলকটা
     হৃৎস্পন্দনের মতো ধুকপুক করে, চারপাশে সবুজ/টিল/সোনালি আভা আর রিং।
     নিচে Inter ফন্টে (Google Fonts) লেখা। লাফিয়ে আসে, ৩ সেকেন্ড থাকে,
     তারপর ঝলকে উঠে ওপরে ভেসে ছোট হয়ে মিলিয়ে যায়। দেখানোর মাঝে আবার
     profit এলে লেখা বদলে সময় নতুন করে শুরু।
     =================================================================== */
  const ORB_ID = "qx-profit-orb";
  const ORB_STYLE_ID = "qx-profit-orb-style";
  const ORB_FONT_ID = "qx-profit-orb-font";
  const ORB_HOLD_MS = 3000;
  const ORB_OUT_MS = 600;
  const ORB_GATHER_MS = 400;
  let orbTimer = null;
  let orbOutTimer = null;
  let orbGatherTimer = null;
  let orbSum = 0;
  const ensureOrbStyle = () => {
    if (!document.getElementById(ORB_FONT_ID)) {
      const lk = document.createElement("link");
      lk.id = ORB_FONT_ID;
      lk.rel = "stylesheet";
      lk.href = "https://fonts.googleapis.com/css2?family=Inter:wght@500;600;800&display=swap";
      (document.head || document.documentElement).appendChild(lk);
    }
    if (document.getElementById(ORB_STYLE_ID)) return;
    const O = "#" + ORB_ID;
    const st = document.createElement("style");
    st.id = ORB_STYLE_ID;
    const AMT_GRAD = "#22d3ee,#67e8f9 30%,#a5f3fc 60%,#22d3ee";
    const T = "translate(-50%,-50%)";
    st.textContent = [
      O + "{position:fixed;left:50%;top:60%;z-index:2147483647;pointer-events:none;display:flex;flex-direction:column;" +
        "align-items:center;gap:clamp(9px,1.8vmin,13px);transform:" + T + " scale(.2);opacity:0;" +
        "--s:clamp(70px,16vmin,100px);font-family:Inter,-apple-system,BlinkMacSystemFont,'SF Pro Display','Segoe UI',Roboto,sans-serif}",
      O + ".in{animation:qxOrbIn .8s cubic-bezier(.22,1,.36,1) forwards}",
      O + ".out{animation:qxOrbOut " + ORB_OUT_MS + "ms cubic-bezier(.55,0,.8,.2) forwards}",
      O + " .core{position:relative;width:var(--s);height:var(--s)}",
      O + " .halo{position:absolute;inset:-40%;border-radius:50%;" +
        "background:radial-gradient(circle,rgba(34,197,94,.55) 0%,rgba(20,184,166,.28) 42%,rgba(251,191,36,.12) 58%,transparent 72%);" +
        "filter:blur(calc(var(--s)*.12));animation:qxOrbHalo 1.2s ease-in-out infinite alternate}",
      O + " .rp{position:absolute;inset:0;border-radius:50%;border:2px solid rgba(52,211,153,.75);" +
        "box-shadow:0 0 16px rgba(34,197,94,.55);opacity:0;animation:qxOrbRipple 2s cubic-bezier(.2,.7,.3,1) infinite}",
      O + " .rp.r2{border-color:rgba(251,191,36,.7);box-shadow:0 0 16px rgba(251,191,36,.45);animation-delay:1s}",
      O + " .orb{position:absolute;inset:0;border-radius:50%;overflow:hidden;" +
        "background:radial-gradient(circle at 34% 28%,#6ee7b7 0%,#10b981 34%,#047857 72%,#064e3b 100%);" +
        "animation:qxOrbBeat 1.4s ease-in-out infinite,qxOrbGlow 1.4s ease-in-out infinite alternate}",
      O + " .orb::before{content:'';position:absolute;left:16%;top:8%;width:52%;height:34%;border-radius:50%;" +
        "background:radial-gradient(ellipse,rgba(255,255,255,.55),rgba(255,255,255,0) 70%)}",
      O + " .orb::after{content:'';position:absolute;inset:0;border-radius:50%;" +
        "box-shadow:inset 0 -6px calc(var(--s)*.14) rgba(6,78,59,.6),inset 0 0 0 1px rgba(255,255,255,.18)}",
      O + " .sh{position:absolute;top:-20%;bottom:-20%;left:-60%;width:40%;transform:skewX(-20deg);" +
        "background:linear-gradient(90deg,transparent,rgba(255,255,255,.35),transparent);animation:qxOrbSweep 2.4s ease-in-out infinite}",
      O + " .ic{position:absolute;left:50%;top:50%;width:44%;height:44%;margin:-22% 0 0 -22%;" +
        "filter:drop-shadow(0 0 6px rgba(251,191,36,.75)) drop-shadow(0 2px 4px rgba(6,78,59,.6));animation:qxOrbBob 1.1s ease-in-out infinite alternate}",
      O + " .sp{position:absolute;bottom:6%;width:7%;height:7%;border-radius:50%;opacity:0;" +
        "background:radial-gradient(circle,#fff 0%,#fde68a 45%,rgba(251,191,36,0) 70%);animation:qxOrbRise 1.8s ease-out infinite}",
      O + " .sp:nth-of-type(1){left:22%;animation-delay:0s}",
      O + " .sp:nth-of-type(2){left:40%;animation-delay:.45s;width:5%;height:5%}",
      O + " .sp:nth-of-type(3){left:58%;animation-delay:.9s}",
      O + " .sp:nth-of-type(4){left:72%;animation-delay:1.3s;width:5%;height:5%}",
      O + " .sp:nth-of-type(5){left:32%;animation-delay:1.1s;width:4%;height:4%}",
      O + " .txt{display:flex;flex-direction:column;align-items:center;line-height:1.1;color:#fff;text-align:center;" +
        "text-shadow:0 2px 16px rgba(34,211,238,.5),0 0 22px rgba(103,232,249,.3);opacity:0}",
      O + ".in .txt{animation:qxOrbTxt .6s .25s cubic-bezier(.22,1,.36,1) forwards}",
      O + ".out .txt{opacity:1}",
      O + " .lbl{font-weight:600;font-size:clamp(10px,1.7vmin,12px);letter-spacing:.2em;text-transform:uppercase;color:#67e8f9;opacity:.95}",
      O + " .amt{font-weight:800;font-size:clamp(21px,4.6vmin,30px);letter-spacing:-.01em;margin-top:3px;" +
        "background:linear-gradient(90deg," + AMT_GRAD + ");-webkit-background-clip:text;background-clip:text;" +
        "-webkit-text-fill-color:transparent;background-size:300% 100%;animation:qxOrbShine 2.4s linear infinite}",
      "@keyframes qxOrbIn{0%{opacity:0;transform:" + T + " scale(.2);filter:blur(12px)}" +
        "55%{opacity:1;transform:" + T + " scale(1.14);filter:blur(0)}" +
        "75%{transform:" + T + " scale(.95)}100%{opacity:1;transform:" + T + " scale(1)}}",
      "@keyframes qxOrbOut{0%{opacity:1;transform:" + T + " scale(1);filter:blur(0) brightness(1)}" +
        "30%{opacity:1;transform:" + T + " scale(1.1);filter:blur(0) brightness(1.4)}" +
        "100%{opacity:0;transform:translate(-50%,-90%) scale(.3);filter:blur(10px) brightness(1)}}",
      "@keyframes qxOrbTxt{from{opacity:0;transform:translateY(16px)}to{opacity:1;transform:none}}",
      "@keyframes qxOrbHalo{from{opacity:.55;transform:scale(.9)}to{opacity:1;transform:scale(1.08)}}",
      "@keyframes qxOrbRipple{0%{opacity:.85;transform:scale(1)}100%{opacity:0;transform:scale(1.9)}}",
      "@keyframes qxOrbBeat{0%,40%,100%{transform:scale(1)}12%{transform:scale(1.07)}24%{transform:scale(.98)}32%{transform:scale(1.03)}}",
      "@keyframes qxOrbGlow{from{box-shadow:0 0 calc(var(--s)*.2) rgba(34,197,94,.55),0 0 calc(var(--s)*.45) rgba(20,184,166,.25)}" +
        "to{box-shadow:0 0 calc(var(--s)*.32) rgba(52,211,153,.7),0 0 calc(var(--s)*.6) rgba(251,191,36,.25)}}",
      "@keyframes qxOrbSweep{0%,35%{left:-60%}75%,100%{left:130%}}",
      "@keyframes qxOrbBob{from{transform:translateY(6%)}to{transform:translateY(-8%)}}",
      "@keyframes qxOrbRise{0%{opacity:0;transform:translateY(0) scale(.6)}20%{opacity:1}100%{opacity:0;transform:translateY(calc(var(--s)*-.75)) scale(1.1)}}",
      "@keyframes qxOrbShine{to{background-position:-300% 0}}",
    ].join("\n");
    (document.head || document.documentElement).appendChild(st);
  };
  const fmtProfit = (n) =>
    "+$" + n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  // কাছাকাছি সময়ে বন্ধ হওয়া ট্রেডের profit যোগ হয়ে একটাই orb: প্রথমটার পর
  // ORB_GATHER_MS অপেক্ষা করে মোট দেখায়; orb দেখানোর মধ্যে আরও এলে মোটে যোগ
  // হয়ে সময় নতুন করে শুরু। orb সরে যাওয়া শুরু হলে মোট শূন্য থেকে।
  const showProfitOrb = (amount) => {
    if (!qxEngineLive || !(amount > 0)) return;
    orbSum = Math.round((orbSum + amount) * 1e4) / 1e4;
    const cur = document.getElementById(ORB_ID);
    if (cur && cur.classList.contains("in")) {
      renderProfitOrb();
      return;
    }
    if (orbGatherTimer) return;
    orbGatherTimer = setTimeout(() => {
      orbGatherTimer = null;
      renderProfitOrb();
    }, ORB_GATHER_MS);
  };
  const renderProfitOrb = () => {
    if (!qxEngineLive || !(orbSum > 0)) return;
    const amount = orbSum;
    ensureOrbStyle();
    let el = document.getElementById(ORB_ID);
    if (!el) {
      el = document.createElement("div");
      el.id = ORB_ID;
      el.setAttribute("aria-live", "polite");
      el.innerHTML =
        '<div class="core"><div class="halo"></div><div class="rp"></div><div class="rp r2"></div>' +
        '<div class="orb"><i class="sh"></i><b class="sp"></b><b class="sp"></b><b class="sp"></b><b class="sp"></b><b class="sp"></b>' +
        '<svg class="ic" viewBox="0 0 24 24"><path d="M12 19V5M5.5 11.5L12 5l6.5 6.5" fill="none" stroke="#fff" ' +
        'stroke-width="2.8" stroke-linecap="round" stroke-linejoin="round"/></svg></div></div>' +
        '<div class="txt"><span class="lbl">Profit</span><span class="amt"></span></div>';
      document.documentElement.appendChild(el);
    }
    el.querySelector(".amt").textContent = fmtProfit(amount);
    clearTimeout(orbTimer);
    clearTimeout(orbOutTimer);
    if (!el.classList.contains("in")) {
      el.classList.remove("out");
      void el.offsetWidth;
      el.classList.add("in");
    }
    orbTimer = setTimeout(() => {
      orbSum = 0;
      el.classList.remove("in");
      el.classList.add("out");
      orbOutTimer = setTimeout(() => el.remove(), ORB_OUT_MS + 50);
    }, ORB_HOLD_MS);
  };
  const removeProfitOrb = () => {
    clearTimeout(orbTimer);
    clearTimeout(orbOutTimer);
    clearTimeout(orbGatherTimer);
    orbGatherTimer = null;
    orbSum = 0;
    for (const id of [ORB_ID, ORB_STYLE_ID, ORB_FONT_ID]) {
      const n = document.getElementById(id);
      if (n) n.remove();
    }
  };

  const proOverlay = $(".pro-overlay");
  const proCandle = $(".pro-candle");
  const proErrCandle = $(".pro-err-candle");

  const finishProSetup = (secRaw) => {
    const sec = Math.max(1, Math.min(3600, Math.round(Number(secRaw) || DEFAULT_CANDLE_SECONDS)));
    ui.candleSeconds = sec;
    setPeriod(sec, "user");
    save();
    qxEngineLive = true;
    setAiGlow(true);
    if (proOverlay) proOverlay.classList.add("out");
  };

  const onProApply = () => {
    const v = proCandle && proCandle.value;
    if (v == null || v === "" || !isFinite(Number(v)) || Number(v) < 1) {
      if (proErrCandle) {
        proErrCandle.hidden = false;
        proErrCandle.textContent = "Enter a valid candle time (seconds).";
      }
      return;
    }
    if (proErrCandle) proErrCandle.hidden = true;
    finishProSetup(v);
  };

  const proApplyBtn = $(".pro-apply");
  if (proApplyBtn) proApplyBtn.addEventListener("click", onProApply);
  if (proCandle) {
    proCandle.addEventListener("keydown", (e) => {
      if (e.key === "Enter") onProApply();
    });
  }

  loadUi();
  (document.body || document.documentElement).appendChild(host);
  if (proCandle) {
    proCandle.value = String(DEFAULT_CANDLE_SECONDS);
    setTimeout(() => proCandle.focus(), 30);
  }

  /* ===================================================================
     আনইনস্টল
     =================================================================== */
  window.qxUninstall = () => {
    try {
      removeAiGlow();
      removeProfitOrb();
      qxEngineLive = false;
      Object.defineProperty(MessageEvent.prototype, "data", nativeDataDesc);
      WebSocket.prototype.send = nativeSend;
      window.WebSocket = NativeWS;
      host.remove();
      delete window.__qxCandleConsole;
      delete window.qxUninstall;
    } catch (_) {}
  };
})();
