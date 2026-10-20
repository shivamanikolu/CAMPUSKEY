/**
 * CAMPUSKEY: Diagnostics & Error Analytics Controller
 * Handles diagnostic error logs, 1-click card enrollment from error logs,
 * failure categorization, and hardware wiring lookup.
 */

let allErrors = [];

// Comprehensive Remediation Matrix matching CAMPUSKEY Architecture
const REMEDIATION_MAP = {
  UNREGISTERED_UID: {
    title: "Unregistered RFID Card Scanned",
    severity: "danger",
    cue: "1 Long Red LED Tone (800ms)",
    action: "Card is physically valid but has not been assigned to any student or faculty record. Click 'Enroll Card Now' to register this tag.",
    hardwareCheck: "Normal hardware operation. Database record missing."
  },
  DUPLICATE_SCAN: {
    title: "Double Attendance Scan Detected",
    severity: "warning",
    cue: "2 Medium Red LED Beeps",
    action: "The user has already checked in for today. CAMPUSKEY enforces exactly one attendance scan per user per calendar date.",
    hardwareCheck: "Normal hardware operation. Business constraint enforced."
  },
  REG_CONFLICT: {
    title: "Registration Collision / Already Registered",
    severity: "warning",
    cue: "1 Long Red Tone (800ms)",
    action: "Attempted to register a card that is already linked to an existing profile in the database. Use another card or edit existing user.",
    hardwareCheck: "Normal hardware operation. Card is already mapped."
  },
  CARD_READ_FAIL: {
    title: "RFID RF Coupling / CRC Checksum Error",
    severity: "warning",
    cue: "3 Fast Red Blinks + 3 Beeps",
    action: "Card was removed too fast or held at an awkward angle. Keep card stationary within 2cm of RC522 reader for 0.5s.",
    hardwareCheck: "Verify 3.3V power stability on breadboard red rail. Ensure RC522 RST is firmly tied to 3.3V."
  },
  WIFI_OFFLINE_SYNC: {
    title: "Network Offline / Flash Storage Queue",
    severity: "info",
    cue: "Red LED Solid ON + 2 Beeps",
    action: "Wi-Fi link was dropped during scan. Scan was recorded to ESP8266 LittleFS memory and uploaded upon reconnect.",
    hardwareCheck: "Check router 2.4 GHz Wi-Fi signal strength near NodeMCU."
  },
  UNAUTHORIZED_DEVICE: {
    title: "Device Security Authentication Failure",
    severity: "danger",
    cue: "Security Alert LCD Tone",
    action: "Request rejected because p_device_key did not match 'CAMPUSKEY_ESP8266_SECRET_2026'.",
    hardwareCheck: "Ensure DEVICE_SECRET in ESP8266 firmware matches PostgreSQL RPC signature."
  }
};

document.addEventListener("DOMContentLoaded", async () => {
  renderNavbar("errors");

  // 0ms Cache-First Render: Instantly display diagnostic logs and metric cards
  if (campusKey.cachedState.errors && campusKey.cachedState.errors.length > 0) {
    allErrors = campusKey.cachedState.errors;
    renderDiagnosticStats();
    renderDiagnosticTable();
  }

  initErrorsPage();

  // Listen to realtime errors
  campusKey.subscribe((eventType) => {
    if (eventType === "ERROR_LOG_CHANGE") {
      loadDiagnosticLogs();
    }
  });
});

async function initErrorsPage() {
  await loadDiagnosticLogs();
}

async function loadDiagnosticLogs() {
  try {
    allErrors = await campusKey.getErrorLogs(200);
    renderDiagnosticStats();
    renderDiagnosticTable();
  } catch (err) {
    console.error("Failed to load error logs:", err);
    showToast("Error retrieving diagnostics", "error");
  }
}

function renderDiagnosticStats() {
  const total = allErrors.length;
  const unreg = allErrors.filter(e => e.error_code === "UNREGISTERED_UID").length;
  const dups = allErrors.filter(e => e.error_code === "DUPLICATE_SCAN").length;
  const other = total - unreg - dups;

  document.getElementById("stat-err-total").innerText = total;
  document.getElementById("stat-err-unreg").innerText = unreg;
  document.getElementById("stat-err-dup").innerText = dups;
  document.getElementById("stat-err-other").innerText = Math.max(0, other);
}

// Interactive Metric Card Filters
function filterByCardType(code) {
  window.activeCardFilter = code;

  // Update active border/glow on metric cards
  document.querySelectorAll(".metric-filter-card").forEach(c => c.style.borderColor = "");
  
  const cardMap = {
    ALL: "card-filter-all",
    UNREGISTERED_UID: "card-filter-unreg",
    DUPLICATE_SCAN: "card-filter-dup",
    OTHER: "card-filter-other"
  };

  const activeCardId = cardMap[code] || "card-filter-all";
  const activeCard = document.getElementById(activeCardId);
  if (activeCard) {
    activeCard.style.borderColor = "var(--primary, #6366f1)";
  }

  // Update select dropdown
  const select = document.getElementById("filter-error-code");
  if (select) {
    select.value = code;
  }

  renderDiagnosticTable();
}

function handleDropdownFilterChange(val) {
  window.activeCardFilter = val;

  // Sync active border on cards
  document.querySelectorAll(".metric-filter-card").forEach(c => c.style.borderColor = "");
  const cardMap = {
    ALL: "card-filter-all",
    UNREGISTERED_UID: "card-filter-unreg",
    DUPLICATE_SCAN: "card-filter-dup",
    OTHER: "card-filter-other"
  };

  const activeCardId = cardMap[val];
  if (activeCardId) {
    const activeCard = document.getElementById(activeCardId);
    if (activeCard) activeCard.style.borderColor = "var(--primary, #6366f1)";
  }

  renderDiagnosticTable();
}

function renderDiagnosticTable() {
  const tbody = document.getElementById("errors-table-body");
  if (!tbody) return;

  const codeFilter = window.activeCardFilter || document.getElementById("filter-error-code")?.value || "ALL";
  const searchFilter = (document.getElementById("search-errors")?.value || "").toLowerCase().trim();

  let filtered = allErrors;

  if (codeFilter === "OTHER") {
    // Other covers CRC, timeouts, offline queue, collisions, etc.
    filtered = filtered.filter(e => e.error_code !== "UNREGISTERED_UID" && e.error_code !== "DUPLICATE_SCAN");
  } else if (codeFilter !== "ALL") {
    filtered = filtered.filter(e => e.error_code === codeFilter);
  }

  if (searchFilter) {
    filtered = filtered.filter(e =>
      (e.card_uid && e.card_uid.toLowerCase().includes(searchFilter)) ||
      (e.user_name && e.user_name.toLowerCase().includes(searchFilter)) ||
      (e.error_message && e.error_message.toLowerCase().includes(searchFilter)) ||
      (e.error_code && e.error_code.toLowerCase().includes(searchFilter))
    );
  }

  if (filtered.length === 0) {
    tbody.innerHTML = `
      <tr>
        <td colspan="6" style="text-align: center; padding: 3rem 1rem; color: var(--text-muted);">
          No diagnostic logs match your filter criteria. System is healthy.
        </td>
      </tr>
    `;
    return;
  }

  tbody.innerHTML = filtered.map(err => {
    const meta = REMEDIATION_MAP[err.error_code] || {
      title: err.error_code,
      severity: "warning",
      cue: "Diagnostic Alert",
      action: err.error_message,
      hardwareCheck: "Check serial monitor output."
    };

    const badgeClass = meta.severity === "danger" 
      ? "metric-badge badge-danger" 
      : (meta.severity === "warning" ? "metric-badge badge-warning" : "metric-badge badge-info");

    const isUnregistered = err.error_code === "UNREGISTERED_UID";

    return `
      <tr>
        <td>
          <div style="font-weight: 600; color: var(--text-bright); font-size: 0.85rem;">
            ${formatRelativeTime(err.created_at)}
          </div>
          <div style="font-size: 0.72rem; color: var(--text-muted); font-family: var(--font-mono);">
            ${formatIST(err.created_at)}
          </div>
        </td>
        <td>
          <div style="display: flex; align-items: center; gap: 0.4rem;">
            <span class="uid-tag">${err.card_uid}</span>
            <button class="icon-btn" style="width: 24px; height: 24px;" onclick="navigator.clipboard.writeText('${err.card_uid}'); showToast('UID copied', 'info');" title="Copy UID">
              <svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor"><rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>
            </button>
          </div>
        </td>
        <td>
          <span class="${badgeClass}">${err.error_code}</span>
          <div style="font-size: 0.75rem; color: var(--text-muted); margin-top: 0.2rem;">
            Mode: ${err.system_mode || 'ATTENDANCE'}
          </div>
        </td>
        <td>
          <div style="font-weight: 500; color: var(--text-bright);">${err.user_name || 'Unknown / Unregistered'}</div>
          <div style="font-size: 0.75rem; color: var(--text-secondary); margin-top: 0.15rem; max-width: 320px;">
            ${err.error_message}
          </div>
        </td>
        <td>
          <div style="font-size: 0.78rem; color: #cbd5e1; max-width: 280px;">
            ${meta.action}
          </div>
          <div style="font-size: 0.7rem; color: var(--text-muted); margin-top: 0.2rem;">
            Audio cue: ${meta.cue}
          </div>
        </td>
        <td>
          ${isUnregistered 
            ? `<button class="btn-primary" style="padding: 0.4rem 0.75rem; font-size: 0.78rem;" onclick="enrollUnregisteredCard('${err.card_uid}')" title="1-Click Card Registration">
                <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2"><path d="M16 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="8.5" cy="7" r="4"/><line x1="20" y1="8" x2="20" y2="14"/><line x1="23" y1="11" x2="17" y2="11"/></svg>
                Enroll Card
               </button>`
            : `<span style="font-size: 0.75rem; color: var(--text-muted);">Logged</span>`
          }
        </td>
      </tr>
    `;
  }).join("");
}

// 1-Click Card Enrollment from error logs!
function enrollUnregisteredCard(cardUid) {
  openRegistrationModal(cardUid);
}

// Clear all diagnostic error logs with guaranteed 2-step confirmation
let clearLogsTimeout = null;

async function handleClearLogs(btn) {
  const btnEl = btn || document.getElementById("btn-clear-logs");
  const textEl = document.getElementById("btn-clear-logs-text") || btnEl;

  if (!btnEl.dataset.confirmState) {
    // First click: Request confirmation
    btnEl.dataset.confirmState = "pending";
    btnEl.style.backgroundColor = "rgba(239, 68, 68, 0.15)";
    btnEl.style.borderColor = "#ef4444";
    btnEl.style.color = "#fca5a5";
    textEl.innerText = "Click to Confirm Clear";

    showToast("Click 'Confirm Clear' again within 4 seconds to purge history", "warning", "Confirmation Needed");

    clearLogsTimeout = setTimeout(() => {
      btnEl.dataset.confirmState = "";
      btnEl.style.backgroundColor = "";
      btnEl.style.borderColor = "";
      btnEl.style.color = "#f87171";
      textEl.innerText = "Clear Logs";
    }, 4000);
    return;
  }

  // Second click: Execute clear
  clearTimeout(clearLogsTimeout);
  btnEl.dataset.confirmState = "";
  btnEl.style.backgroundColor = "";
  btnEl.style.borderColor = "";
  btnEl.style.color = "#f87171";
  textEl.innerText = "Clearing...";

  try {
    await campusKey.clearErrorLogs();
    textEl.innerText = "Logs Cleared!";
    showToast("Successfully cleared diagnostic history from database", "success");
    await loadDiagnosticLogs();
    setTimeout(() => {
      textEl.innerText = "Clear Logs";
    }, 2000);
  } catch (err) {
    textEl.innerText = "Clear Logs";
    showToast(err.message, "error", "Clear Failed");
  }
}

// Export error logs to CSV
function exportErrorLogsCSV() {
  if (allErrors.length === 0) {
    showToast("No diagnostic logs to export", "warning");
    return;
  }

  let csvContent = `data:text/csv;charset=utf-8,`;
  csvContent += `"CAMPUSKEY Hardware & System Diagnostic Logs"\n`;
  csvContent += `"Institution:","${CAMPUSKEY_CONFIG.INSTITUTION}"\n`;
  csvContent += `"Exported At:","${new Date().toISOString()}"\n\n`;
  csvContent += `"Timestamp (IST)","Card UID","Error Code","Matched User","System Mode","Error Details"\n`;

  allErrors.forEach(e => {
    csvContent += `"${formatIST(e.created_at)}","${e.card_uid}","${e.error_code}","${e.user_name || 'N/A'}","${e.system_mode || 'ATTENDANCE'}","${(e.error_message || '').replace(/"/g, '""')}"\n`;
  });

  const encodedUri = encodeURI(csvContent);
  const link = document.createElement("a");
  link.setAttribute("href", encodedUri);
  link.setAttribute("download", `CAMPUSKEY_Diagnostic_Errors_${new Date().toISOString().split("T")[0]}.csv`);
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);

  showToast("Exported error logs to CSV", "success");
}
