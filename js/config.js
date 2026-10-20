/**
 * CAMPUSKEY: Smart RFID Attendance & Identity System
 * Configuration & Core Audio-Visual Helpers
 */

const CAMPUSKEY_CONFIG = {
  SUPABASE_URL: "https://qnuewgwuiubpdlnatuez.supabase.co",
  SUPABASE_ANON_KEY: "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InFudWV3Z3d1aXVicGRsbmF0dWV6Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3OTI0NjM0NjUsImV4cCI6MjEwODAzOTQ2NX0.d6NxbXEw-X5rUmEe59nEGj9kvdSSky1SlNUen-3K6kI",
  DEVICE_SECRET: "CAMPUSKEY_ESP8266_SECRET_2026",
  INSTITUTION: "ICFAI School of Science & Technology",
  PROGRAM: "BCA / Computer Science & Technology",
  POLL_INTERVAL_MS: 3000, // 3-second smart fallback poll
  AUDIO_ENABLED_KEY: "campuskey_sound_enabled"
};

// ======================== WEB AUDIO BUZZER SYNTHESIZER ========================
// Replicates the physical NodeMCU 5V buzzer frequencies and chirp patterns
class HardwareBuzzerSynth {
  constructor() {
    this.ctx = null;
    this.enabled = localStorage.getItem(CAMPUSKEY_CONFIG.AUDIO_ENABLED_KEY) !== "false";
  }

  init() {
    if (!this.ctx) {
      const AudioCtx = window.AudioContext || window.webkitAudioContext;
      if (AudioCtx) this.ctx = new AudioCtx();
    }
    if (this.ctx && this.ctx.state === "suspended") {
      this.ctx.resume();
    }
  }

  toggleSound() {
    this.enabled = !this.enabled;
    localStorage.setItem(CAMPUSKEY_CONFIG.AUDIO_ENABLED_KEY, this.enabled ? "true" : "false");
    return this.enabled;
  }

  playTone(freq, durationMs, type = "sine") {
    if (!this.enabled) return;
    try {
      this.init();
      if (!this.ctx) return;
      const osc = this.ctx.createOscillator();
      const gain = this.ctx.createGain();
      osc.type = type;
      osc.frequency.setValueAtTime(freq, this.ctx.currentTime);
      gain.gain.setValueAtTime(0.15, this.ctx.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.001, this.ctx.currentTime + (durationMs / 1000));
      osc.connect(gain);
      gain.connect(this.ctx.destination);
      osc.start();
      osc.stop(this.ctx.currentTime + (durationMs / 1000));
    } catch (e) {
      console.warn("Audio error:", e);
    }
  }

  // 1 crisp 150ms beep (Success Attendance)
  playSuccess() {
    this.playTone(2400, 150, "sine");
  }

  // 2 quick high beeps (New Card Registered)
  playRegistered() {
    this.playTone(2800, 100, "square");
    setTimeout(() => this.playTone(3200, 120, "square"), 140);
  }

  // 2 medium beeps (Duplicate Scan Warning)
  playDuplicate() {
    this.playTone(1200, 250, "triangle");
    setTimeout(() => this.playTone(1200, 250, "triangle"), 320);
  }

  // 1 long low warning buzz (Denied / Unregistered Card)
  playDenied() {
    this.playTone(450, 750, "sawtooth");
  }

  // 3 fast urgent beeps (Hardware error / Wire loose)
  playHardwareError() {
    this.playTone(1800, 80, "sawtooth");
    setTimeout(() => this.playTone(1800, 80, "sawtooth"), 120);
    setTimeout(() => this.playTone(1800, 80, "sawtooth"), 240);
  }

  // Short chirp (Registration mode activated)
  playChirp() {
    this.playTone(2000, 80, "sine");
  }
}

const buzzer = new HardwareBuzzerSynth();

// ======================== TOAST NOTIFICATION SYSTEM ========================
function showToast(message, type = "info", title = "") {
  let container = document.getElementById("toast-container");
  if (!container) {
    container = document.createElement("div");
    container.id = "toast-container";
    container.className = "toast-container";
    document.body.appendChild(container);
  }

  const toast = document.createElement("div");
  toast.className = `toast toast-${type}`;

  const iconMap = {
    success: `<svg class="toast-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"/><polyline points="22 4 12 14.01 9 11.01"/></svg>`,
    error: `<svg class="toast-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><line x1="15" y1="9" x2="9" y2="15"/><line x1="9" y1="9" x2="15" y2="15"/></svg>`,
    warning: `<svg class="toast-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg>`,
    info: `<svg class="toast-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><line x1="12" y1="16" x2="12" y2="12"/><line x1="12" y1="8" x2="12.01" y2="8"/></svg>`
  };

  toast.innerHTML = `
    <div class="toast-indicator"></div>
    <div class="toast-icon-wrap">${iconMap[type] || iconMap.info}</div>
    <div class="toast-body">
      ${title ? `<div class="toast-title">${title}</div>` : ""}
      <div class="toast-message">${message}</div>
    </div>
    <button class="toast-close" onclick="this.parentElement.remove()">&times;</button>
  `;

  container.appendChild(toast);
  setTimeout(() => toast.classList.add("toast-show"), 10);

  setTimeout(() => {
    toast.classList.remove("toast-show");
    setTimeout(() => toast.remove(), 400);
  }, 4500);
}

// Format relative time (e.g. "Just now", "2m ago")
function formatRelativeTime(dateString) {
  if (!dateString) return "N/A";
  const date = new Date(dateString);
  const diffSec = Math.floor((new Date() - date) / 1000);
  if (diffSec < 10) return "Just now";
  if (diffSec < 60) return `${diffSec}s ago`;
  const diffMin = Math.floor(diffSec / 60);
  if (diffMin < 60) return `${diffMin}m ago`;
  const diffHour = Math.floor(diffMin / 60);
  if (diffHour < 24) return `${diffHour}h ago`;
  return date.toLocaleDateString("en-IN", { month: "short", day: "numeric" });
}

// Format full datetime in Indian Standard Time (IST)
function formatIST(dateString, includeSeconds = true) {
  if (!dateString) return "N/A";
  const date = new Date(dateString);
  return date.toLocaleString("en-IN", {
    timeZone: "Asia/Kolkata",
    day: "2-digit",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    second: includeSeconds ? "2-digit" : undefined,
    hour12: true
  });
}

// Format time only (e.g. "10:30 AM")
function formatTimeOnly(dateString) {
  if (!dateString) return "N/A";
  const date = new Date(dateString);
  return date.toLocaleTimeString("en-IN", {
    timeZone: "Asia/Kolkata",
    hour: "2-digit",
    minute: "2-digit",
    hour12: true
  });
}
