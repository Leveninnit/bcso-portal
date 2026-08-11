/**
 * Shared visual + audio polish for every page: scroll-reveal animation,
 * pop-in animation for dynamically-rendered content (Command Access
 * dashboard tabs, etc.), and a small synthesized sound-effects engine.
 *
 * Sounds are generated on the fly with the Web Audio API (short
 * oscillator "beeps"), not audio files — no external downloads, nothing
 * to fetch, and no copyright/licensing concerns. Include this script
 * on every page (after assets/main.js) and it wires itself up
 * automatically. Other page scripts can also call window.BCSOEffects
 * directly for more precise cues (see assets/apply.js, assets/log.js,
 * assets/command-access.js).
 */
(function () {
  "use strict";

  const MUTE_KEY = "bcso-sfx-muted";
  const REVEAL_SELECTOR = [
    ".value-card",
    ".sub-card",
    ".stat",
    ".honor-card",
    ".leadership-card",
    ".team-card",
    ".ca-submission-card",
    ".panel",
  ].join(",");
  const POP_SELECTOR = [
    ".ca-submission-card",
    ".ca-question-row",
    ".ca-movement-row",
    ".team-card",
  ].join(",");

  const prefersReducedMotion =
    window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches;

  // ------------------------------------------------------------------
  // Sound engine — every "sound effect" in this site is a short
  // synthesized tone. No audio files are loaded from anywhere.
  // ------------------------------------------------------------------
  let audioCtx = null;
  let lastHoverAt = 0;

  function isMuted() {
    try {
      return localStorage.getItem(MUTE_KEY) === "1";
    } catch {
      return false;
    }
  }
  function setMuted(muted) {
    try {
      localStorage.setItem(MUTE_KEY, muted ? "1" : "0");
    } catch {
      // Private browsing / storage disabled — just won't persist.
    }
  }
  function ensureCtx() {
    if (isMuted()) return null;
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return null;
    if (!audioCtx) audioCtx = new AC();
    if (audioCtx.state === "suspended") audioCtx.resume().catch(() => {});
    return audioCtx;
  }

  // Schedule one short oscillator "note". freqEnd (optional) sweeps the
  // pitch across the note's duration, used for the sci-fi power-up/buzz
  // sounds below.
  function tone({ freq = 440, freqEnd = null, duration = 0.12, type = "sine", gain = 0.06, delay = 0 }) {
    const ctx = ensureCtx();
    if (!ctx) return;
    const t0 = ctx.currentTime + delay;
    const osc = ctx.createOscillator();
    const g = ctx.createGain();
    osc.type = type;
    osc.frequency.setValueAtTime(freq, t0);
    if (freqEnd) osc.frequency.exponentialRampToValueAtTime(Math.max(freqEnd, 1), t0 + duration);
    g.gain.setValueAtTime(0.0001, t0);
    g.gain.linearRampToValueAtTime(gain, t0 + 0.01);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + duration);
    osc.connect(g).connect(ctx.destination);
    osc.start(t0);
    osc.stop(t0 + duration + 0.03);
  }

  function playClick() {
    tone({ freq: 780, duration: 0.045, type: "square", gain: 0.045 });
  }
  function playHover() {
    const now = Date.now();
    if (now - lastHoverAt < 140) return; // throttle so hover-scrubbing isn't noisy
    lastHoverAt = now;
    tone({ freq: 1300, duration: 0.02, type: "sine", gain: 0.015 });
  }
  function playToggle() {
    tone({ freq: 660, duration: 0.05, type: "triangle", gain: 0.05 });
    tone({ freq: 880, duration: 0.05, type: "triangle", gain: 0.04, delay: 0.05 });
  }
  function playSuccess() {
    tone({ freq: 523.25, duration: 0.09, type: "sine", gain: 0.06, delay: 0 }); // C5
    tone({ freq: 659.25, duration: 0.09, type: "sine", gain: 0.06, delay: 0.09 }); // E5
    tone({ freq: 783.99, duration: 0.16, type: "sine", gain: 0.07, delay: 0.18 }); // G5
  }
  function playError() {
    tone({ freq: 220, freqEnd: 150, duration: 0.16, type: "sawtooth", gain: 0.06, delay: 0 });
    tone({ freq: 200, freqEnd: 130, duration: 0.2, type: "sawtooth", gain: 0.06, delay: 0.14 });
  }
  // The "command access verified" cue — a sci-fi terminal-unlock sound:
  // a low sub thump, a rising power-up sweep, then a bright two-note
  // confirmation chime.
  function playAuthGranted() {
    tone({ freq: 90, duration: 0.16, type: "sine", gain: 0.09, delay: 0 });
    tone({ freq: 220, freqEnd: 900, duration: 0.3, type: "sine", gain: 0.05, delay: 0.02 });
    tone({ freq: 988, duration: 0.1, type: "sine", gain: 0.07, delay: 0.33 }); // B5
    tone({ freq: 1318.5, duration: 0.18, type: "sine", gain: 0.08, delay: 0.44 }); // E6
    speakAuthorized();
  }
  // Access-denied cue — two flat, low buzzes.
  function playAuthDenied() {
    tone({ freq: 150, freqEnd: 90, duration: 0.22, type: "square", gain: 0.07, delay: 0 });
    tone({ freq: 150, freqEnd: 90, duration: 0.22, type: "square", gain: 0.07, delay: 0.28 });
    speakDenied();
  }

  // ------------------------------------------------------------------
  // Spoken authority-voice line, using the browser's built-in
  // Speech Synthesis API — not a recording, so there's nothing to
  // download or license. Pitched down and slowed slightly so it reads
  // as a stern command-terminal voice rather than a normal narrator.
  // ------------------------------------------------------------------
  let cachedVoices = [];
  function refreshVoices() {
    try {
      cachedVoices = (window.speechSynthesis && window.speechSynthesis.getVoices()) || [];
    } catch {
      cachedVoices = [];
    }
  }
  if ("speechSynthesis" in window) {
    refreshVoices();
    window.speechSynthesis.onvoiceschanged = refreshVoices;
  }
  function pickAuthorityVoice() {
    // Prefer a deeper/male-leaning English voice if the browser offers
    // one, so it sounds more like an authority figure than a default
    // assistant voice. Falls back to whatever the browser picks.
    const byName = (re) => cachedVoices.find((v) => re.test(v.name) && /en/i.test(v.lang));
    return (
      byName(/\b(David|Daniel|Guy|Mark|Google UK English Male)\b/i) ||
      cachedVoices.find((v) => /en/i.test(v.lang)) ||
      null
    );
  }
  function speak(text, { rate = 0.92, pitch = 0.72, volume = 1 } = {}) {
    if (isMuted()) return;
    if (!("speechSynthesis" in window)) return;
    try {
      window.speechSynthesis.cancel(); // don't let lines stack up/overlap
      const utter = new SpeechSynthesisUtterance(text);
      utter.rate = rate;
      utter.pitch = pitch;
      utter.volume = volume;
      const voice = pickAuthorityVoice();
      if (voice) utter.voice = voice;
      window.speechSynthesis.speak(utter);
    } catch {
      // Speech synthesis is a nice-to-have on top of the tones above —
      // ignore failures quietly (e.g. unsupported browser).
    }
  }
  function speakAuthorized() {
    // Fires just after the granted chime finishes so the two don't talk
    // over each other.
    setTimeout(() => speak("Command authorised."), 650);
  }
  function speakDenied() {
    setTimeout(() => speak("Access denied."), 550);
  }

  // ------------------------------------------------------------------
  // Global click / hover sound delegation — covers every button and
  // nav link on every page without needing to touch each page's markup.
  // ------------------------------------------------------------------
  document.addEventListener(
    "click",
    (e) => {
      const target = e.target.closest("button, a.btn, nav.main-nav a");
      if (!target || target.id === "bcso-sound-toggle") return;
      playClick();
    },
    true
  );
  document.addEventListener(
    "mouseover",
    (e) => {
      const target = e.target.closest("nav.main-nav a, .btn-gold");
      if (!target) return;
      playHover();
    },
    true
  );

  // ------------------------------------------------------------------
  // Scroll-reveal for content present at load, pop-in for content
  // rendered later (e.g. Command Access switching tabs).
  // ------------------------------------------------------------------
  let revealObserver = null;
  function armReveal(el) {
    if (prefersReducedMotion || el.dataset.bcsoArmed) return;
    el.dataset.bcsoArmed = "1";
    el.classList.add("bcso-reveal");
    revealObserver.observe(el);
  }
  function popIn(el) {
    if (prefersReducedMotion || el.dataset.bcsoPopped) return;
    el.dataset.bcsoPopped = "1";
    el.classList.add("bcso-pop");
    el.addEventListener(
      "animationend",
      () => {
        el.classList.remove("bcso-pop");
        delete el.dataset.bcsoPopped;
      },
      { once: true }
    );
  }

  function setupObservers() {
    if (!("IntersectionObserver" in window) || prefersReducedMotion) return;
    revealObserver = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          if (entry.isIntersecting) {
            entry.target.classList.add("bcso-in");
            revealObserver.unobserve(entry.target);
          }
        });
      },
      { threshold: 0.12, rootMargin: "0px 0px -40px 0px" }
    );
    document.querySelectorAll(REVEAL_SELECTOR).forEach(armReveal);

    // Watch for content rendered after the initial load (dashboards,
    // tab switches, admin panels) and give it a quick pop-in instead of
    // waiting for it to scroll into view — it's usually already visible.
    const mo = new MutationObserver((mutations) => {
      mutations.forEach((m) => {
        m.addedNodes.forEach((node) => {
          if (node.nodeType !== 1) return;
          if (node.matches && node.matches(POP_SELECTOR)) popIn(node);
          if (node.querySelectorAll) node.querySelectorAll(POP_SELECTOR).forEach(popIn);
        });
      });
    });
    mo.observe(document.body, { childList: true, subtree: true });
  }

  // ------------------------------------------------------------------
  // Sound on/off toggle, injected into the header once main.js mounts it.
  // ------------------------------------------------------------------
  function setupSoundToggle() {
    // Appends into nav.main-nav itself, NOT header.site-header .container.
    // .container is styled `display: flex; justify-content: space-between`
    // expecting exactly its two existing children (.brand and nav.main-nav)
    // -- adding this button as a THIRD direct child there used to throw
    // off that space-between split (three items sharing the gap instead
    // of two), shifting the nav links away from the right edge. Making
    // the button a flex item *inside* nav.main-nav instead (pushed to the
    // end via margin-left: auto in style.css) keeps .container's layout
    // exactly as before while still landing the button at the far right.
    const nav = document.querySelector("header.site-header .main-nav");
    if (!nav || document.getElementById("bcso-sound-toggle")) return;
    const btn = document.createElement("button");
    btn.type = "button";
    btn.id = "bcso-sound-toggle";
    btn.className = "sound-toggle-btn";
    const paint = () => {
      const muted = isMuted();
      btn.textContent = muted ? "\u{1F507}" : "\u{1F50A}";
      btn.setAttribute("aria-label", muted ? "Unmute sound effects" : "Mute sound effects");
      btn.title = muted ? "Sound effects are off — click to turn on" : "Sound effects are on — click to turn off";
      btn.classList.toggle("is-muted", muted);
    };
    btn.addEventListener("click", () => {
      const nowMuted = !isMuted();
      setMuted(nowMuted);
      paint();
      if (!nowMuted) playToggle();
    });
    paint();
    nav.appendChild(btn);
  }

  function init() {
    setupSoundToggle();
    setupObservers();
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }

  window.BCSOEffects = {
    playClick,
    playHover,
    playToggle,
    playSuccess,
    playError,
    playAuthGranted,
    playAuthDenied,
    speak,
    isMuted,
    setMuted,
  };
})();
