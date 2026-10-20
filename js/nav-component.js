/**
 * CAMPUSKEY: Shared Navigation, Live System Mode Pill & Universal Registration Modal
 */

function renderNavbar(activePage = "dashboard") {
  const navContainer = document.getElementById("main-navbar");
  if (!navContainer) return;

  navContainer.className = "navbar";
  navContainer.innerHTML = `
    <div class="nav-brand">
      <div class="brand-icon-wrap">
        <svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round">
          <rect x="2" y="5" width="20" height="14" rx="2"/>
          <line x1="2" y1="10" x2="22" y2="10"/>
          <circle cx="7" cy="15" r="1"/>
          <path d="M12 15h6"/>
        </svg>
      </div>
      <div class="brand-text">
        <h1>CAMPUS<span>KEY</span> <span class="brand-badge">IoT RFID</span></h1>
        <div class="brand-sub">ICFAI School of Science & Tech • ICSD</div>
      </div>
    </div>

    <ul class="nav-links" id="nav-menu">
      <li>
        <a href="index.html" class="nav-link ${activePage === 'dashboard' ? 'active' : ''}">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor"><rect x="3" y="3" width="7" height="7"/><rect x="14" y="3" width="7" height="7"/><rect x="14" y="14" width="7" height="7"/><rect x="3" y="14" width="7" height="7"/></svg>
          Dashboard
        </a>
      </li>
      <li>
        <a href="attendance.html" class="nav-link ${activePage === 'attendance' ? 'active' : ''}">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor"><path d="M9 11l3 3L22 4"/><path d="M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11"/></svg>
          Attendance
        </a>
      </li>
      <li>
        <a href="users.html" class="nav-link ${activePage === 'users' ? 'active' : ''}">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/></svg>
          Users & Cards
        </a>
      </li>
      <li>
        <a href="errors.html" class="nav-link ${activePage === 'errors' ? 'active' : ''}">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg>
          Diagnostics
        </a>
      </li>
    </ul>

    <div class="nav-controls">
      <!-- Live NodeMCU & Supabase Status -->
      <div class="system-status-pill" id="nav-system-status">
        <span class="pulse-dot" id="nav-status-dot"></span>
        <span id="nav-status-text">NodeMCU Online</span>
      </div>

      <!-- Quick 60s Scan Activation -->
      <button class="btn-primary pulse-glow" onclick="openRegistrationModal()" title="Start 60s Hardware Registration Mode">
        <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2">
          <path d="M12 5v14M5 12h14"/>
        </svg>
        <span>New Registration</span>
      </button>
    </div>
  `;

  initRegistrationModalDOM();
  listenToSystemState();
  setupInstantPagePrefetch();
}

// ======================== INSTANT SUB-MILLISECOND PAGE PREFETCH ========================
function setupInstantPagePrefetch() {
  const links = document.querySelectorAll("#nav-menu a.nav-link, a[href$='.html']");
  const prefetched = new Set();

  function prefetchUrl(url) {
    if (!url || prefetched.has(url) || url.startsWith("#") || url.startsWith("http")) return;
    prefetched.add(url);

    // 1. Browser hint prefetch tag
    const linkEl = document.createElement("link");
    linkEl.rel = "prefetch";
    linkEl.href = url;
    document.head.appendChild(linkEl);

    // 2. Prewarm HTTP disk/memory cache with low priority
    if (window.fetch) {
      try {
        fetch(url, { priority: "low" }).catch(() => {});
      } catch (e) {}
    }
  }

  // Prewarm target page on hover or touch before click happens
  links.forEach(link => {
    const href = link.getAttribute("href");
    if (!href) return;
    link.addEventListener("mouseenter", () => prefetchUrl(href), { passive: true });
    link.addEventListener("touchstart", () => prefetchUrl(href), { passive: true });
  });

  // Background idle prefetch for all 4 core application routes
  const corePages = ["index.html", "attendance.html", "users.html", "errors.html"];
  const triggerIdlePrefetch = () => {
    corePages.forEach(page => {
      if (!window.location.pathname.endsWith(page)) {
        prefetchUrl(page);
      }
    });
  };

  if ("requestIdleCallback" in window) {
    window.requestIdleCallback(triggerIdlePrefetch);
  } else {
    setTimeout(triggerIdlePrefetch, 1200);
  }
}

// ======================== UNIVERSAL 60S REGISTRATION MODAL ========================
let regCountdownInterval = null;
let currentRemainingSec = 60;
let isModalAwaitingCard = false;
let currentRegSessionStartTime = 0;
let baselineErrorId = null;
let baselineRegisteredUID = null;
let baselineUserId = null;

function initRegistrationModalDOM() {
  if (document.getElementById("universal-reg-modal")) return;

  const modalHtml = `
    <div class="modal-overlay" id="universal-reg-modal">
      <div class="modal-card">
        <div class="modal-header">
          <h3>RFID Card Enrollment</h3>
          <button class="modal-close-btn" onclick="closeRegistrationModal()">&times;</button>
        </div>

        <!-- STEP 1: SCANNING WAITING FOR CARD -->
        <div id="reg-step-scan" class="countdown-wrap">
          <div class="countdown-timer-circle">
            <div class="radar-ping-ring"></div>
            <svg class="countdown-svg">
              <circle class="countdown-bg" cx="70" cy="70" r="58"></circle>
              <circle id="reg-progress-circle" class="countdown-progress" cx="70" cy="70" r="58" stroke-dasharray="364.4" stroke-dashoffset="0"></circle>
            </svg>
            <div class="countdown-number">
              <span id="reg-countdown-display">60</span>
              <div class="countdown-seconds-label">SEC REMAINING</div>
            </div>
          </div>
          <div class="registration-step-title">Tap New RFID Tag on NodeMCU</div>
          <div class="registration-step-desc">
            The ESP8266 reader is currently in Registration Mode. Hold the brand-new card within 2 cm of the RC522 antenna.
          </div>
          <div style="margin-top: 1.5rem; display: flex; justify-content: center; gap: 0.75rem;">
            <button class="btn-secondary" onclick="closeRegistrationModal()">Cancel Window</button>
            <button class="btn-secondary" onclick="switchToManualUIDForm()">Enter UID Manually</button>
          </div>
        </div>

        <!-- STEP 2: CARD CAPTURED -> FILL PROFILE -->
        <div id="reg-step-form" style="display: none;">
          <div id="reg-header-banner" style="display: flex; align-items: center; gap: 0.75rem; background: rgba(16, 185, 129, 0.12); border: 1px solid rgba(16, 185, 129, 0.35); padding: 0.85rem 1rem; border-radius: var(--radius-md); margin-bottom: 1.25rem;">
            <svg viewBox="0 0 24 24" width="24" height="24" fill="none" stroke="#10b981" stroke-width="2.5"><path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"/><polyline points="22 4 12 14.01 9 11.01"/></svg>
            <div>
              <div id="reg-banner-title" style="font-weight: 700; color: #34d399; font-size: 0.95rem;">RFID Card Detected!</div>
              <div id="reg-banner-sub" style="font-size: 0.8rem; color: var(--text-secondary);">Hardware UID: <span id="captured-uid-badge" class="uid-tag" style="font-size: 0.85rem; font-weight: 700; color: #67e8f9;">--------</span></div>
            </div>
          </div>

          <form id="reg-profile-form" onsubmit="handleSaveRegisteredUser(event)">
            <div class="form-group full-width" style="margin-bottom: 1rem;">
              <label class="form-label">RFID Hardware UID (Hexadecimal) *</label>
              <input type="text" id="form-card-uid" name="card_uid" class="form-control" style="font-family: var(--font-mono); font-weight: 700; color: #67e8f9; text-transform: uppercase; letter-spacing: 0.08em;" placeholder="e.g. CD2363F8" required />
            </div>
            <div class="form-grid">
              <div class="form-group">
                <label class="form-label">User Category *</label>
                <select id="form-user-type" class="form-control" onchange="toggleFormRoleFields(this.value)" required>
                  <option value="STUDENT">Student</option>
                  <option value="FACULTY">Faculty Member</option>
                </select>
              </div>

              <div class="form-group">
                <label class="form-label" id="label-roll">Enrollment / Roll No. *</label>
                <input type="text" id="form-enrollment" class="form-control" placeholder="e.g. 24BCAS042" required />
              </div>

              <div class="form-group full-width">
                <label class="form-label">Full Name *</label>
                <input type="text" id="form-name" class="form-control" placeholder="e.g. Rahul Sharma" required />
              </div>

              <div class="form-group">
                <label class="form-label">Branch *</label>
                <select id="form-branch" class="form-control" required>
                  <option value="BACHELOR OF COMPUTER APPLICATIONS">BACHELOR OF COMPUTER APPLICATIONS</option>
                  <option value="BACHELOR OF TECHNOLOGY">BACHELOR OF TECHNOLOGY</option>
                  <option value="BACHELOR OF BUSINESS ADMINISTRATION">BACHELOR OF BUSINESS ADMINISTRATION</option>
                  <option value="BACHELOR OF SCIENCE">BACHELOR OF SCIENCE</option>
                  <option value="BACHELOR OF COMMERCE">BACHELOR OF COMMERCE</option>
                </select>
              </div>

              <div class="form-group">
                <label class="form-label" id="label-course">Course / Class</label>
                <input type="text" id="form-course" class="form-control" value="BCA - Sem 1" required />
              </div>

              <div class="form-group full-width">
                <label class="form-label">Mobile Number (Optional)</label>
                <input type="tel" id="form-mobile" class="form-control" placeholder="+91 98765 43210" />
              </div>
            </div>

            <div class="form-actions">
              <button type="button" class="btn-secondary" onclick="closeRegistrationModal()">Cancel</button>
              <button type="submit" class="btn-primary" id="btn-save-user">
                <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2"><path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2z"/><polyline points="17 21 17 13 7 13 7 21"/><polyline points="7 3 7 8 15 8"/></svg>
                Save & Activate ID
              </button>
            </div>
          </form>
        </div>
      </div>
    </div>
  `;

  document.body.insertAdjacentHTML("beforeend", modalHtml);
}

function toggleFormRoleFields(type) {
  const labelRoll = document.getElementById("label-roll");
  const labelCourse = document.getElementById("label-course");
  const inputCourse = document.getElementById("form-course");

  if (type === "FACULTY") {
    labelRoll.innerText = "Employee ID / Code *";
    labelCourse.innerText = "Designation / Role";
    inputCourse.value = "Assistant Professor";
  } else {
    labelRoll.innerText = "Enrollment / Roll No. *";
    labelCourse.innerText = "Course / Class";
    inputCourse.value = "BCA - Sem 1";
  }
}

function restoreStepScanDOM() {
  const stepScan = document.getElementById("reg-step-scan");
  const stepForm = document.getElementById("reg-step-form");
  if (stepForm) stepForm.style.display = "none";
  if (!stepScan) return;
  stepScan.className = "countdown-wrap";
  stepScan.style.display = "block";
  stepScan.innerHTML = `
    <div class="countdown-timer-circle">
      <div class="radar-ping-ring"></div>
      <svg class="countdown-svg">
        <circle class="countdown-bg" cx="70" cy="70" r="58"></circle>
        <circle id="reg-progress-circle" class="countdown-progress" cx="70" cy="70" r="58" stroke-dasharray="364.4" stroke-dashoffset="0"></circle>
      </svg>
      <div class="countdown-number">
        <span id="reg-countdown-display">60</span>
        <div class="countdown-seconds-label">SEC REMAINING</div>
      </div>
    </div>
    <div class="registration-step-title">Tap New RFID Tag on NodeMCU</div>
    <div class="registration-step-desc">
      The ESP8266 reader is currently in Registration Mode. Hold the brand-new card within 2 cm of the RC522 antenna.
    </div>
    <div style="margin-top: 1.5rem; display: flex; justify-content: center; gap: 0.75rem;">
      <button class="btn-secondary" onclick="closeRegistrationModal()">Cancel Window</button>
      <button class="btn-secondary" onclick="switchToManualUIDForm()">Enter UID Manually</button>
    </div>
  `;
}

async function openRegistrationModal(prefilledUid = null) {
  initRegistrationModalDOM();
  restoreStepScanDOM();
  const modal = document.getElementById("universal-reg-modal");
  const stepScan = document.getElementById("reg-step-scan");
  const stepForm = document.getElementById("reg-step-form");

  if (modal) {
    modal.classList.add("active");
    modal.style.display = "flex";
  }

  if (prefilledUid) {
    // Direct enrollment (e.g. from 1-click button on diagnostics error log)
    isModalAwaitingCard = false;
    showRegistrationForm(prefilledUid);
    return;
  }

  // Set fresh session baselines to ignore all prior errors and prior card UIDs
  currentRegSessionStartTime = Date.now();
  baselineErrorId = campusKey.cachedState.errors?.[0]?.id || null;
  baselineRegisteredUID = campusKey.cachedState.systemState?.last_registered_uid || null;
  baselineUserId = campusKey.cachedState.users?.[0]?.id || null;

  // Activate 60s window
  isModalAwaitingCard = true;
  if (stepScan) stepScan.style.display = "block";
  if (stepForm) stepForm.style.display = "none";
  currentRemainingSec = 60;
  updateCountdownRing(60);

  try {
    await campusKey.setRegistrationMode(60);
    showToast("Registration mode active for 60 seconds", "warning", "ESP8266 Live");
  } catch (err) {
    showToast(err.message, "error", "Registration Error");
  }

  if (regCountdownInterval) clearInterval(regCountdownInterval);
  regCountdownInterval = setInterval(() => {
    currentRemainingSec--;
    updateCountdownRing(currentRemainingSec);
    if (currentRemainingSec <= 0) {
      clearInterval(regCountdownInterval);
      handleRegistrationTimeout();
    }
  }, 1000);
}

function updateCountdownRing(sec) {
  const display = document.getElementById("reg-countdown-display");
  const circle = document.getElementById("reg-progress-circle");
  if (display) display.innerText = sec;
  if (circle) {
    const totalCircumference = 364.4;
    const offset = totalCircumference - (sec / 60) * totalCircumference;
    circle.style.strokeDashoffset = offset;
  }
}

function showRegistrationForm(cardUid, placeholderUser = null, isManual = false) {
  // Immediately halt the countdown
  if (regCountdownInterval) clearInterval(regCountdownInterval);
  isModalAwaitingCard = false;

  const modal = document.getElementById("universal-reg-modal");
  if (modal) {
    modal.classList.add("active");
    modal.style.display = "flex";
  }

  const stepScan = document.getElementById("reg-step-scan");
  const stepForm = document.getElementById("reg-step-form");
  const uidBadge = document.getElementById("captured-uid-badge");
  const uidInput = document.getElementById("form-card-uid");
  const bannerTitle = document.getElementById("reg-banner-title");
  const bannerSub = document.getElementById("reg-banner-sub");

  if (stepScan) stepScan.style.display = "none";
  if (stepForm) stepForm.style.display = "block";

  if (isManual) {
    if (bannerTitle) bannerTitle.innerText = "Manual User & Card Enrollment";
    if (bannerSub) bannerSub.innerHTML = `Enter UID & student details directly`;
    if (uidBadge) uidBadge.innerText = "MANUAL ENTRY";
    if (uidInput) {
      uidInput.value = cardUid || "";
      uidInput.readOnly = false;
    }
    setTimeout(() => {
      if (uidInput && !cardUid) uidInput.focus();
      else {
        const nameField = document.getElementById("form-name");
        if (nameField) nameField.focus();
      }
    }, 150);
  } else {
    if (bannerTitle) bannerTitle.innerText = "RFID Card Detected!";
    if (bannerSub) bannerSub.innerHTML = `Hardware UID: <span id="captured-uid-badge" class="uid-tag" style="font-size: 0.85rem; font-weight: 700; color: #67e8f9;">${cardUid}</span>`;
    if (uidBadge) uidBadge.innerText = cardUid;
    if (uidInput) {
      uidInput.value = cardUid;
      uidInput.readOnly = true;
    }

    // Pre-fill fields if user already exists
    if (placeholderUser) {
      const fullNameInput = document.getElementById("form-name");
      const enrInput = document.getElementById("form-enrollment");
      if (fullNameInput && placeholderUser.full_name && !placeholderUser.full_name.startsWith("New Card (")) {
        fullNameInput.value = placeholderUser.full_name;
      } else if (fullNameInput) {
        fullNameInput.value = "";
      }
      if (enrInput && placeholderUser.enrollment_or_roll && !placeholderUser.enrollment_or_roll.startsWith("PENDING-")) {
        enrInput.value = placeholderUser.enrollment_or_roll;
      }
    } else {
      const nameField = document.getElementById("form-name");
      if (nameField) nameField.value = "";
    }

    setTimeout(() => {
      const nameField = document.getElementById("form-name");
      if (nameField) nameField.focus();
    }, 150);

    showToast(`RFID Tag ${cardUid} detected! Please fill user details.`, "success", "Card Captured");
  }
}

function switchToManualUIDForm() {
  initRegistrationModalDOM();
  restoreStepScanDOM();
  showRegistrationForm("", null, true);
}

async function closeRegistrationModal() {
  if (regCountdownInterval) clearInterval(regCountdownInterval);
  isModalAwaitingCard = false;
  const modal = document.getElementById("universal-reg-modal");
  if (modal) {
    modal.classList.remove("active");
    modal.style.display = "none";
  }

  try {
    await campusKey.cancelRegistrationMode();
  } catch (e) {}
}

async function handleRegistrationTimeout() {
  if (!isModalAwaitingCard) return;
  showToast("Registration window timed out. ESP8266 returned to Attendance mode.", "info", "Time Expired");
  closeRegistrationModal();
}

function handleRegistrationConflictError(err) {
  if (regCountdownInterval) clearInterval(regCountdownInterval);
  isModalAwaitingCard = false;

  const cardUid = err.card_uid || "Card";
  const userName = err.user_name || "Existing Profile";

  const stepScan = document.getElementById("reg-step-scan");
  if (stepScan) {
    stepScan.innerHTML = `
      <div style="text-align: center; padding: 1rem 0;">
        <div style="width: 68px; height: 68px; border-radius: 50%; background: rgba(239, 68, 68, 0.15); border: 2px solid #ef4444; display: flex; align-items: center; justify-content: center; margin: 0 auto 1.25rem auto;">
          <svg viewBox="0 0 24 24" width="34" height="34" fill="none" stroke="#ef4444" stroke-width="2.2"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg>
        </div>
        <div style="font-size: 1.18rem; font-weight: 700; color: #f87171; margin-bottom: 0.4rem;">Card Already Registered!</div>
        <div style="font-size: 0.9rem; color: var(--text-secondary); max-width: 400px; margin: 0 auto 1.15rem auto; line-height: 1.5;">
          Card UID <span class="uid-tag" style="color: #f87171; font-weight: 700;">${cardUid}</span> is already assigned to <strong>${userName}</strong>.
        </div>
        <div style="background: rgba(239, 68, 68, 0.08); border: 1px solid rgba(239, 68, 68, 0.25); border-radius: var(--radius-md); padding: 0.75rem 1rem; margin-bottom: 1.5rem; font-size: 0.8rem; color: #fca5a5; text-align: left; line-height: 1.6;">
          <div><strong>LCD Display:</strong> USER EXISTS! / Card In Use</div>
          <div><strong>Diagnostic Code:</strong> REG_CONFLICT (Prevented Duplicate)</div>
          <div><strong>Next Step:</strong> Tap an unassigned card, or edit this user in Users & Cards.</div>
        </div>
        <div style="display: flex; justify-content: center; gap: 0.75rem;">
          <button class="btn-primary" onclick="openRegistrationModal()" style="background: #ef4444; border-color: #ef4444;">
            <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2"><path d="M23 4v6h-6"/><path d="M1 20v-6h6"/><path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15"/></svg>
            Scan Another Card
          </button>
          <button class="btn-secondary" onclick="closeRegistrationModal()">Dismiss</button>
        </div>
      </div>
    `;
  }

  showToast(
    `Card ${cardUid} already belongs to ${userName}! Countdown stopped.`,
    "error",
    "Registration Collision"
  );
}

async function handleSaveRegisteredUser(e) {
  e.preventDefault();
  const btn = document.getElementById("btn-save-user");
  btn.disabled = true;
  btn.innerHTML = `Saving Profile...`;

  const cardUid = document.getElementById("form-card-uid").value.trim().toUpperCase();
  const userType = document.getElementById("form-user-type").value;
  const fullName = document.getElementById("form-name").value.trim();
  const enrollment = document.getElementById("form-enrollment").value.trim();
  const branch = document.getElementById("form-branch").value.trim();
  const course = document.getElementById("form-course").value.trim();
  const mobile = document.getElementById("form-mobile").value.trim();

  try {
    await campusKey.saveRegisteredUserProfile({
      card_uid: cardUid,
      user_type: userType,
      full_name: fullName,
      enrollment_or_roll: enrollment,
      branch: branch,
      course_or_role: course,
      mobile_number: mobile,
      is_active: true
    });

    showToast(`Successfully registered ${fullName} (${cardUid})`, "success", "ID Profile Activated");
    closeRegistrationModal();

    if (typeof refreshPageData === "function") {
      refreshPageData();
    }
    if (typeof loadUsersList === "function") {
      loadUsersList();
    }
  } catch (err) {
    showToast(err.message, "error", "Save Failed");
  } finally {
    btn.disabled = false;
    btn.innerHTML = `<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2"><path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2z"/><polyline points="17 21 17 13 7 13 7 21"/><polyline points="7 3 7 8 15 8"/></svg> Save & Activate ID`;
  }
}

// System state real-time watcher
function listenToSystemState() {
  campusKey.subscribe((eventType, payload) => {
    // Only process modal transitions if waiting for a card
    if (isModalAwaitingCard) {
      // 1. Conflict detection from ERROR_LOG_CHANGE (strictly from THIS active session!)
      if (eventType === "ERROR_LOG_CHANGE") {
        const err = payload?.new;
        if (err && (err.error_code === "REG_CONFLICT" || err.system_mode === "REGISTRATION")) {
          const errTime = new Date(err.created_at || Date.now()).getTime();
          if (err.id !== baselineErrorId && errTime >= (currentRegSessionStartTime - 2000)) {
            handleRegistrationConflictError(err);
            return;
          }
        }
      }

      // 2. Direct CARD_CAPTURED event
      if (eventType === "CARD_CAPTURED" && payload?.card_uid) {
        showRegistrationForm(payload.card_uid, payload.placeholder_user);
        return;
      }

      // 3. User created during registration
      if (eventType === "USERS_CHANGE" && payload?.latest) {
        const u = payload.latest;
        const userTime = new Date(u.created_at || Date.now()).getTime();
        if (u.id !== baselineUserId && userTime >= (currentRegSessionStartTime - 2000)) {
          showRegistrationForm(u.card_uid, u);
          return;
        }
      }

      // 4. System state change
      if (eventType === "SYSTEM_STATE_CHANGE") {
        const state = payload?.new || payload;

        // Check if brand-new card UID was captured
        if (state.last_registered_uid && state.last_registered_uid !== baselineRegisteredUID) {
          showRegistrationForm(state.last_registered_uid);
          return;
        }

        // Check if brand-new conflict error was recorded in this session
        const latestErr = campusKey.cachedState.errors?.[0];
        if (latestErr && latestErr.id !== baselineErrorId && latestErr.error_code === "REG_CONFLICT") {
          const errTime = new Date(latestErr.created_at || Date.now()).getTime();
          if (errTime >= (currentRegSessionStartTime - 2000)) {
            handleRegistrationConflictError(latestErr);
            return;
          }
        }

        // Check if brand-new placeholder user was recorded in this session
        const latestUser = campusKey.cachedState.users?.[0];
        if (latestUser && latestUser.id !== baselineUserId && latestUser.full_name?.startsWith("New Card (")) {
          const userTime = new Date(latestUser.created_at || Date.now()).getTime();
          if (userTime >= (currentRegSessionStartTime - 2000)) {
            showRegistrationForm(latestUser.card_uid, latestUser);
            return;
          }
        }

        // If mode returned to ATTENDANCE and countdown has expired
        if (state.mode === "ATTENDANCE" && currentRemainingSec <= 1) {
          if (regCountdownInterval) clearInterval(regCountdownInterval);
          isModalAwaitingCard = false;
          showToast("Registration window closed.", "info", "Scan Ended");
          closeRegistrationModal();
        }
      }
    }

    // Update Navbar Status Pill
    if (eventType === "SYSTEM_STATE_CHANGE") {
      const state = payload?.new || payload;
      const statusText = document.getElementById("nav-status-text");
      const statusDot = document.getElementById("nav-status-dot");
      if (statusText && statusDot) {
        if (state.mode === "REGISTRATION") {
          statusText.innerText = "Registration Active";
          statusDot.className = "pulse-dot registration";
        } else {
          statusText.innerText = "Attendance Ready";
          statusDot.className = "pulse-dot";
        }
      }
    }
  });
}
