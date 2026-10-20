/**
 * CAMPUSKEY: Users & Hardware Cards Controller
 * Manages Student & Faculty directories, profile modifications, deletions,
 * and card UID assignments.
 */

let activeUserTab = "STUDENT";
let cachedUserList = [];
let editingUserId = null;

document.addEventListener("DOMContentLoaded", async () => {
  renderNavbar("users");

  // 0ms Cache-First Render: Instantly display users and counts without waiting
  if (campusKey.cachedState.users && campusKey.cachedState.users.length > 0) {
    cachedUserList = campusKey.cachedState.users;
    renderUsersDirectory();
    updateUserCounters();
  }

  initUsersPage();

  // Listen to realtime user changes
  campusKey.subscribe((eventType) => {
    if (eventType === "USERS_CHANGE" || eventType === "SYSTEM_STATE_CHANGE") {
      loadUsersList();
    }
  });
});

async function initUsersPage() {
  await loadUsersList();
}

function switchUserTab(type) {
  activeUserTab = type;
  document.getElementById("user-tab-students").className = `tab-btn ${type === 'STUDENT' ? 'active' : ''}`;
  document.getElementById("user-tab-faculty").className = `tab-btn ${type === 'FACULTY' ? 'active' : ''}`;
  renderUsersDirectory();
}

async function loadUsersList() {
  try {
    cachedUserList = await campusKey.getUsers("ALL");
    renderUsersDirectory();
    updateUserCounters();
  } catch (err) {
    console.error("Failed to fetch users:", err);
    showToast("Error loading user records", "error");
  }
}

function updateUserCounters() {
  const stdCount = cachedUserList.filter(u => u.user_type === "STUDENT").length;
  const facCount = cachedUserList.filter(u => u.user_type === "FACULTY").length;

  const scEl = document.getElementById("count-users-std");
  const fcEl = document.getElementById("count-users-fac");
  if (scEl) scEl.innerText = stdCount;
  if (fcEl) fcEl.innerText = facCount;
}

function renderUsersDirectory() {
  const tbody = document.getElementById("users-table-body");
  if (!tbody) return;

  const searchQuery = (document.getElementById("search-users")?.value || "").toLowerCase().trim();
  const branchFilter = document.getElementById("filter-user-branch")?.value || "ALL";

  let filtered = cachedUserList.filter(u => u.user_type === activeUserTab);

  if (branchFilter !== "ALL") {
    filtered = filtered.filter(u => u.branch === branchFilter);
  }

  if (searchQuery) {
    filtered = filtered.filter(u => 
      (u.full_name && u.full_name.toLowerCase().includes(searchQuery)) ||
      (u.enrollment_or_roll && u.enrollment_or_roll.toLowerCase().includes(searchQuery)) ||
      (u.card_uid && u.card_uid.toLowerCase().includes(searchQuery)) ||
      (u.mobile_number && u.mobile_number.includes(searchQuery))
    );
  }

  if (filtered.length === 0) {
    tbody.innerHTML = `
      <tr>
        <td colspan="7" style="text-align: center; padding: 3.5rem 1rem; color: var(--text-muted);">
          <div style="font-size: 1rem; font-weight: 600; color: var(--text-secondary); margin-bottom: 0.5rem;">
            No ${activeUserTab.toLowerCase()} profiles found
          </div>
          <div style="font-size: 0.85rem; max-width: 380px; margin: 0 auto 1.5rem auto;">
            Click the "60s Hardware Scan" button above or "Add User Manually" to enroll a new RFID card.
          </div>
          <button class="btn-primary" onclick="openRegistrationModal()">
            <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 5v14M5 12h14"/></svg>
            Enroll First ${activeUserTab === 'STUDENT' ? 'Student' : 'Faculty'} Card
          </button>
        </td>
      </tr>
    `;
    return;
  }

  tbody.innerHTML = filtered.map(u => {
    const initials = (u.full_name || "U").split(" ").map(w => w[0]).join("").slice(0, 2).toUpperCase();
    const avatarClass = u.user_type === "FACULTY" ? "avatar-circle faculty" : "avatar-circle";
    const statusBadge = u.is_active 
      ? `<span class="metric-badge badge-success">ACTIVE</span>` 
      : `<span class="metric-badge badge-danger">INACTIVE</span>`;

    return `
      <tr>
        <td>
          <div class="table-user-cell">
            <div class="${avatarClass}">${initials}</div>
            <div>
              <div style="font-weight: 600; color: var(--text-bright);">${u.full_name}</div>
              <div class="user-cell-meta">${u.enrollment_or_roll || 'No ID Specified'}</div>
            </div>
          </div>
        </td>
        <td>
          <div style="display: flex; align-items: center; gap: 0.5rem;">
            <span class="uid-tag">${u.card_uid}</span>
            <button class="icon-btn" style="width: 26px; height: 26px; border-radius: 4px;" onclick="copyCardUID('${u.card_uid}')" title="Copy UID">
              <svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" stroke-width="2"><rect x="9" y="9" width="13" height="13" rx="2" ry="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>
            </button>
          </div>
        </td>
        <td>
          <div style="font-weight: 500;">${u.branch || 'BCA'}</div>
          <div class="user-cell-meta">${u.course_or_role || 'General'}</div>
        </td>
        <td>
          <span style="font-family: var(--font-mono); font-size: 0.8rem; color: var(--text-secondary);">
            ${u.mobile_number || 'Not Linked'}
          </span>
        </td>
        <td>${statusBadge}</td>
        <td>
          <span style="font-size: 0.75rem; color: var(--text-muted);">
            ${formatIST(u.created_at, false)}
          </span>
        </td>
        <td>
          <div style="display: flex; align-items: center; gap: 0.4rem;">
            <button class="btn-secondary" style="padding: 0.35rem 0.65rem; font-size: 0.78rem;" onclick="openEditUserModal('${u.id}')" title="Edit Profile">
              <svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" stroke-width="2"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>
              Edit
            </button>
            <button class="btn-secondary" style="padding: 0.35rem 0.55rem; font-size: 0.78rem; color: #f87171;" onclick="deleteUserProfile('${u.id}', '${(u.full_name || '').replace(/'/g, "\\'")}', this)" title="Delete Profile">
              <svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" stroke-width="2"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg>
            </button>
          </div>
        </td>
      </tr>
    `;
  }).join("");
}

function copyCardUID(uid) {
  navigator.clipboard.writeText(uid).then(() => {
    showToast(`Copied UID ${uid} to clipboard`, "info");
  });
}

// ======================== EDIT USER MODAL ========================
function openEditUserModal(userId) {
  const user = cachedUserList.find(u => u.id === userId);
  if (!user) return;

  editingUserId = userId;
  document.getElementById("edit-user-id").value = user.id;
  document.getElementById("edit-card-uid").value = user.card_uid;
  document.getElementById("edit-user-type").value = user.user_type;
  document.getElementById("edit-full-name").value = user.full_name;
  document.getElementById("edit-enrollment").value = user.enrollment_or_roll || "";
  
  const branchSelect = document.getElementById("edit-branch");
  if (branchSelect) {
    let matched = Array.from(branchSelect.options).some(o => o.value === user.branch);
    if (!matched && user.branch) {
      const opt = new Option(user.branch, user.branch);
      branchSelect.add(opt);
    }
    branchSelect.value = user.branch || "BACHELOR OF COMPUTER APPLICATIONS";
  }

  document.getElementById("edit-course").value = user.course_or_role || "";
  document.getElementById("edit-mobile").value = user.mobile_number || "";
  document.getElementById("edit-status").value = user.is_active ? "true" : "false";

  document.getElementById("edit-user-modal").classList.add("active");
}

function closeEditUserModal() {
  editingUserId = null;
  document.getElementById("edit-user-modal").classList.remove("active");
}

async function handleUpdateUserProfile(e) {
  e.preventDefault();
  const btn = document.getElementById("btn-submit-edit");
  btn.disabled = true;
  btn.innerText = "Saving changes...";

  const userId = document.getElementById("edit-user-id").value;
  const payload = {
    card_uid: document.getElementById("edit-card-uid").value.trim().toUpperCase(),
    user_type: document.getElementById("edit-user-type").value,
    full_name: document.getElementById("edit-full-name").value.trim(),
    enrollment_or_roll: document.getElementById("edit-enrollment").value.trim(),
    branch: document.getElementById("edit-branch").value.trim(),
    course_or_role: document.getElementById("edit-course").value.trim(),
    mobile_number: document.getElementById("edit-mobile").value.trim(),
    is_active: document.getElementById("edit-status").value === "true"
  };

  try {
    await campusKey.updateUser(userId, payload);
    showToast(`Updated profile for ${payload.full_name}`, "success");
    closeEditUserModal();
    await loadUsersList();
  } catch (err) {
    showToast(err.message, "error", "Update Failed");
  } finally {
    btn.disabled = false;
    btn.innerText = "Save Changes";
  }
}

let userDeleteTimeoutMap = {};

async function deleteUserProfile(userId, name, btn) {
  const user = cachedUserList.find(u => u.id === userId);
  const targetName = name || (user ? user.full_name : "User");

  if (btn && !btn.dataset.confirmState) {
    btn.dataset.confirmState = "pending";
    btn.style.backgroundColor = "rgba(239, 68, 68, 0.18)";
    btn.style.borderColor = "#ef4444";
    btn.style.color = "#ef4444";
    btn.innerHTML = `<span style="font-size: 0.72rem; font-weight: 700; white-space: nowrap;">Confirm?</span>`;

    showToast(`Click 'Confirm?' again within 4s to delete ${targetName}`, "warning", "Confirmation Needed");

    userDeleteTimeoutMap[userId] = setTimeout(() => {
      btn.dataset.confirmState = "";
      btn.style.backgroundColor = "";
      btn.style.borderColor = "";
      btn.style.color = "#f87171";
      btn.innerHTML = `<svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" stroke-width="2"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg>`;
      delete userDeleteTimeoutMap[userId];
    }, 4000);
    return;
  }

  if (userDeleteTimeoutMap[userId]) {
    clearTimeout(userDeleteTimeoutMap[userId]);
    delete userDeleteTimeoutMap[userId];
  }

  // Optimistic UI Removal: Instant 0ms response
  cachedUserList = cachedUserList.filter(u => u.id !== userId);
  renderUsersDirectory();
  renderUserStats();

  try {
    await campusKey.deleteUser(userId);
    showToast(`Successfully deleted ${targetName}`, "info", "Profile Removed");
    await loadUsersList();
  } catch (err) {
    showToast(err.message, "error", "Deletion Failed");
    await loadUsersList();
  }
}

// Global hook called when new card registered in universal modal
function refreshPageData() {
  loadUsersList();
}

const renderUserStats = updateUserCounters;
const handleSaveEditedUser = handleUpdateUserProfile;
