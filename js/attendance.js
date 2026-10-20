/**
 * CAMPUSKEY: Attendance Management Controller
 * Handles student/faculty tab switching, date filtering, 75% attendance calculations,
 * manual attendance adjustments, and export to CSV/Excel/Print.
 */

let currentTab = "STUDENT"; // 'STUDENT' or 'FACULTY'
let allUsers = [];
let selectedDateLogs = [];
let monthlyAttendanceLogs = [];

document.addEventListener("DOMContentLoaded", async () => {
  renderNavbar("attendance");

  // Set default date to today
  const today = new Date().toISOString().split("T")[0];
  const dateInput = document.getElementById("filter-date");
  if (dateInput) dateInput.value = today;

  // 0ms Cache-First Render: Display populated table and stats immediately with zero wait
  if (campusKey.cachedState.users && campusKey.cachedState.users.length > 0) {
    allUsers = campusKey.cachedState.users;
    selectedDateLogs = campusKey.cachedState.todayAttendance || [];
    renderAttendanceTable();
    updateSummaryStats(today);
  }

  initAttendancePage();

  // Listen to attendance updates in realtime
  campusKey.subscribe((eventType) => {
    if (eventType === "ATTENDANCE_CHANGE" || eventType === "USERS_CHANGE") {
      loadAttendanceData();
    }
  });
});

async function initAttendancePage() {
  await loadAttendanceData();
}

function switchTab(type) {
  currentTab = type;
  document.getElementById("tab-btn-students").className = `tab-btn ${type === 'STUDENT' ? 'active' : ''}`;
  document.getElementById("tab-btn-faculty").className = `tab-btn ${type === 'FACULTY' ? 'active' : ''}`;
  
  const headerRole = document.getElementById("att-col-branch-role");
  if (headerRole) {
    headerRole.innerText = type === "FACULTY" ? "Designation / Role" : "Branch";
  }
  
  renderAttendanceTable();
}

async function loadAttendanceData() {
  const dateInput = document.getElementById("filter-date");
  const selectedDate = dateInput ? dateInput.value : new Date().toISOString().split("T")[0];

  try {
    const yearMonth = selectedDate.substring(0, 7); // 'YYYY-MM'
    const startOfMonth = `${yearMonth}-01`;
    const endOfMonth = `${yearMonth}-31`;

    // Fetch all streams IN PARALLEL (Promise.all) - 0ms wait on cache hit, instant parallel fallback
    const [users, dayLogs, monthLogs] = await Promise.all([
      campusKey.getUsers(),
      campusKey.getAttendanceByDateRange(selectedDate, selectedDate),
      campusKey.getAttendanceByDateRange(startOfMonth, endOfMonth)
    ]);

    allUsers = users;
    selectedDateLogs = dayLogs;
    monthlyAttendanceLogs = monthLogs;

    renderAttendanceTable();
    updateSummaryStats(selectedDate);
  } catch (err) {
    console.error("Error loading attendance:", err);
  }
}

function updateSummaryStats(selectedDate) {
  const filteredUsers = allUsers.filter(u => u.user_type === currentTab);
  const total = filteredUsers.length;

  const presentCount = selectedDateLogs.filter(l => l.users && l.users.user_type === currentTab).length;
  const absentCount = Math.max(0, total - presentCount);
  const rate = total > 0 ? Math.round((presentCount / total) * 100) : 0;

  document.getElementById("stat-att-total").innerText = total;
  document.getElementById("stat-att-present").innerText = presentCount;
  document.getElementById("stat-att-absent").innerText = absentCount;
  document.getElementById("stat-att-rate").innerText = `${rate}%`;

  // Update tab counters
  const studentCount = allUsers.filter(u => u.user_type === "STUDENT").length;
  const facultyCount = allUsers.filter(u => u.user_type === "FACULTY").length;
  const sc = document.getElementById("count-students-tab");
  const fc = document.getElementById("count-faculty-tab");
  if (sc) sc.innerText = studentCount;
  if (fc) fc.innerText = facultyCount;
}

function renderAttendanceTable() {
  const tbody = document.getElementById("attendance-table-body");
  if (!tbody) return;

  const searchQuery = (document.getElementById("search-input")?.value || "").toLowerCase().trim();
  const branchFilter = document.getElementById("filter-branch")?.value || "ALL";
  const statusFilter = document.getElementById("filter-status")?.value || "ALL";
  const riskFilter = document.getElementById("filter-risk")?.value || "ALL"; // 'ALL' or 'BELOW_75'

  // Filter users by tab (STUDENT or FACULTY)
  let usersToDisplay = allUsers.filter(u => u.user_type === currentTab);

  // Apply branch filter
  if (branchFilter !== "ALL") {
    usersToDisplay = usersToDisplay.filter(u => u.branch === branchFilter);
  }

  // Apply search query
  if (searchQuery) {
    usersToDisplay = usersToDisplay.filter(u =>
      (u.full_name && u.full_name.toLowerCase().includes(searchQuery)) ||
      (u.enrollment_or_roll && u.enrollment_or_roll.toLowerCase().includes(searchQuery)) ||
      (u.card_uid && u.card_uid.toLowerCase().includes(searchQuery))
    );
  }

  // Calculate monthly stats for each user (Assuming 24 working days in a month)
  const workingDaysInMonth = 24;
  const userRows = usersToDisplay.map(user => {
    // Check if user is present on selected date
    const dayLog = selectedDateLogs.find(l => l.user_id === user.id);
    const isPresent = !!dayLog;

    // Monthly attendance count
    const monthScans = monthlyAttendanceLogs.filter(l => l.user_id === user.id);
    const monthPresentDays = monthScans.length;
    const monthlyPct = Math.min(100, Math.round((monthPresentDays / workingDaysInMonth) * 100));

    return {
      user,
      dayLog,
      isPresent,
      monthPresentDays,
      monthlyPct
    };
  });

  // Apply status filter (PRESENT or ABSENT)
  let filteredRows = userRows;
  if (statusFilter === "PRESENT") {
    filteredRows = filteredRows.filter(r => r.isPresent);
  } else if (statusFilter === "ABSENT") {
    filteredRows = filteredRows.filter(r => !r.isPresent);
  }

  // Apply Below 75% risk filter
  if (riskFilter === "BELOW_75") {
    filteredRows = filteredRows.filter(r => r.monthlyPct < 75);
  }

  if (filteredRows.length === 0) {
    tbody.innerHTML = `
      <tr>
        <td colspan="8" style="text-align: center; padding: 3rem 1rem; color: var(--text-muted);">
          No ${currentTab.toLowerCase()} records match your filter criteria.
        </td>
      </tr>
    `;
    return;
  }

  const dateInput = document.getElementById("filter-date");
  const selectedDate = dateInput ? dateInput.value : new Date().toISOString().split("T")[0];

  tbody.innerHTML = filteredRows.map(row => {
    const u = row.user;
    const initials = (u.full_name || "U").split(" ").map(w => w[0]).join("").slice(0, 2).toUpperCase();
    const avatarClass = u.user_type === "FACULTY" ? "avatar-circle faculty" : "avatar-circle";

    const isBelow75 = currentTab === "STUDENT" && row.monthlyPct < 75;
    const pctBadgeClass = isBelow75 ? "badge-danger" : "badge-success";

    const statusBadge = row.isPresent
      ? `<span class="metric-badge badge-success">PRESENT</span>`
      : `<span class="metric-badge badge-danger">ABSENT</span>`;

    const checkInTime = row.dayLog ? formatTimeOnly(row.dayLog.check_in_time) : "--:--";
    const displayDate = row.dayLog?.scan_date || selectedDate;

    return `
      <tr>
        <td>
          <div class="table-user-cell">
            <div class="${avatarClass}">${initials}</div>
            <div>
              <div style="font-weight: 600; color: var(--text-bright);">${u.full_name}</div>
              <div class="user-cell-meta">${u.enrollment_or_roll || 'No Roll ID'}</div>
            </div>
          </div>
        </td>
        <td><span class="uid-tag">${u.card_uid}</span></td>
        <td>
          ${currentTab === 'FACULTY' 
            ? `<div style="font-weight: 500;">${u.course_or_role || 'Faculty Member'}</div>
               <div class="user-cell-meta">${u.branch || 'General'}</div>`
            : `<div style="font-weight: 500;">${u.branch || 'BACHELOR OF COMPUTER APPLICATIONS'}</div>
               <div class="user-cell-meta">${u.course_or_role || 'General'}</div>`
          }
        </td>
        <td>
          <span style="font-family: var(--font-mono); font-size: 0.85rem; color: ${row.isPresent ? '#34d399' : 'var(--text-muted)'};">
            ${checkInTime}
          </span>
        </td>
        <td>
          <span style="font-family: var(--font-mono); font-size: 0.82rem; color: var(--text-secondary);">
            ${displayDate}
          </span>
        </td>
        <td>${statusBadge}</td>
        <td>
          <div style="display: flex; align-items: center; gap: 0.5rem;">
            <span class="metric-badge ${pctBadgeClass}">${row.monthlyPct}%</span>
            ${isBelow75 ? `<span style="color: #ef4444; font-size: 0.72rem; font-weight: 600;">⚠ Low Att.</span>` : ''}
          </div>
          <div style="font-size: 0.72rem; color: var(--text-muted); margin-top: 0.15rem;">
            ${row.monthPresentDays} / ${workingDaysInMonth} Days
          </div>
        </td>
        <td>
          <div style="display: flex; align-items: center; gap: 0.4rem;">
            ${row.isPresent 
              ? `<button class="btn-secondary" style="padding: 0.35rem 0.65rem; font-size: 0.78rem;" onclick="removeAttendanceLog('${row.dayLog.id}', '${(u.full_name || '').replace(/'/g, "\\'")}', this)" title="Remove scan entry">
                  Mark Absent
                 </button>`
              : `<button class="btn-secondary" style="padding: 0.35rem 0.65rem; font-size: 0.78rem; color: #34d399; border-color: rgba(16, 185, 129, 0.3);" onclick="manualMarkPresent('${u.id}', '${u.card_uid}', '${(u.full_name || '').replace(/'/g, "\\'")}')" title="Manually mark present">
                  Mark Present
                 </button>`
            }
          </div>
        </td>
      </tr>
    `;
  }).join("");
}

// ======================== MANUAL ATTENDANCE ADJUSTMENT ========================
async function manualMarkPresent(userId, cardUid, userName) {
  const dateInput = document.getElementById("filter-date");
  const targetDate = dateInput ? dateInput.value : new Date().toISOString().split("T")[0];

  try {
    await campusKey.manualMarkAttendance(userId, cardUid, targetDate, "PRESENT");
    showToast(`Marked ${userName} as PRESENT for ${targetDate}`, "success");
    buzzer.playSuccess();
    await loadAttendanceData();
  } catch (err) {
    showToast(err.message, "error", "Failed Adjustment");
  }
}

let attendanceRevertTimeoutMap = {};

async function removeAttendanceLog(logId, userName, btn) {
  const dateInput = document.getElementById("filter-date");
  const selectedDate = dateInput ? dateInput.value : new Date().toISOString().split("T")[0];

  if (btn && !btn.dataset.confirmState) {
    btn.dataset.confirmState = "pending";
    btn.style.color = "#ef4444";
    btn.style.borderColor = "#ef4444";
    btn.style.backgroundColor = "rgba(239, 68, 68, 0.15)";
    btn.innerText = "Confirm Absent?";

    showToast(`Click 'Confirm Absent?' again within 4s to mark ${userName} absent`, "warning", "Confirmation Needed");

    attendanceRevertTimeoutMap[logId] = setTimeout(() => {
      btn.dataset.confirmState = "";
      btn.style.color = "";
      btn.style.borderColor = "";
      btn.style.backgroundColor = "";
      btn.innerText = "Mark Absent";
      delete attendanceRevertTimeoutMap[logId];
    }, 4000);
    return;
  }

  if (attendanceRevertTimeoutMap[logId]) {
    clearTimeout(attendanceRevertTimeoutMap[logId]);
    delete attendanceRevertTimeoutMap[logId];
  }

  // Optimistic UI Update: Instant 0ms response
  selectedDateLogs = selectedDateLogs.filter(l => l.id !== logId);
  monthlyAttendanceLogs = monthlyAttendanceLogs.filter(l => l.id !== logId);
  renderAttendanceTable();
  updateSummaryStats(selectedDate);

  try {
    await campusKey.deleteAttendanceLog(logId);
    showToast(`Marked ${userName} as ABSENT for ${selectedDate}`, "info", "Check-in Reverted");
    await loadAttendanceData();
  } catch (err) {
    showToast(err.message, "error", "Failed Removal");
    await loadAttendanceData();
  }
}

// ======================== EXPORT SUITE ========================
function exportAttendanceCSV() {
  const dateInput = document.getElementById("filter-date");
  const targetDate = dateInput ? dateInput.value : new Date().toISOString().split("T")[0];

  const filteredUsers = allUsers.filter(u => u.user_type === currentTab);
  if (filteredUsers.length === 0) {
    showToast("No data available to export", "warning");
    return;
  }

  let csvContent = `data:text/csv;charset=utf-8,`;
  // Header Row
  csvContent += `"CAMPUSKEY RFID Attendance Sheet"\n`;
  csvContent += `"Institution:","${CAMPUSKEY_CONFIG.INSTITUTION}"\n`;
  csvContent += `"Date:","${targetDate}","Category:","${currentTab}"\n\n`;
  csvContent += `"Roll/Employee ID","Full Name","Card UID","Branch/Department","Course/Role","Date","Check-In Time","Status","Monthly Attendance %"\n`;

  filteredUsers.forEach(u => {
    const dayLog = selectedDateLogs.find(l => l.user_id === u.id);
    const isPresent = !!dayLog;
    const time = dayLog ? formatTimeOnly(dayLog.check_in_time) : "N/A";
    const status = isPresent ? "PRESENT" : "ABSENT";
    
    const monthScans = monthlyAttendanceLogs.filter(l => l.user_id === u.id);
    const monthlyPct = Math.min(100, Math.round((monthScans.length / 24) * 100));

    csvContent += `"${u.enrollment_or_roll || ''}","${u.full_name}","${u.card_uid}","${u.branch || ''}","${u.course_or_role || ''}","${targetDate}","${time}","${status}","${monthlyPct}%"\n`;
  });

  const encodedUri = encodeURI(csvContent);
  const link = document.createElement("a");
  link.setAttribute("href", encodedUri);
  link.setAttribute("download", `CAMPUSKEY_${currentTab}_Attendance_${targetDate}.csv`);
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);

  showToast(`Exported ${currentTab} attendance report to CSV`, "success");
}

function printAttendanceSheet() {
  const dateInput = document.getElementById("filter-date");
  const targetDate = dateInput ? dateInput.value : new Date().toISOString().split("T")[0];
  
  // Set date in print header
  const printDateEl = document.getElementById("print-sheet-date");
  const printTypeEl = document.getElementById("print-sheet-type");
  if (printDateEl) printDateEl.innerText = `Date: ${targetDate}`;
  if (printTypeEl) printTypeEl.innerText = `Category: ${currentTab} Attendance Register`;

  window.print();
}
