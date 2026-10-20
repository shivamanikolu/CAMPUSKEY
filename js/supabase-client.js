/**
 * CAMPUSKEY: Supabase Data Access Layer & High-Frequency Realtime Synchronizer
 * Sub-second active synchronization engine for immediate hardware-to-web telemetry.
 */

class CampusKeyDataService {
  constructor() {
    this.client = null;
    this.isInitialized = false;
    this.realtimeSubscribers = [];
    this.pollingTimer = null;
    this.isPollingActive = false;
    this.syncDebounceTimer = null;

    // Snapshot Hashes for instant change detection
    this.lastStateHash = "";
    this.lastAttHash = "";
    this.lastErrHash = "";
    this.lastUserHash = "";
    this.registrationBaselineUID = null;

    // Persistent in-memory + sessionStorage state (Instant 0ms render across page transitions)
    this.cachedState = {
      users: [],
      todayAttendance: [],
      errors: [],
      systemState: { mode: "ATTENDANCE", last_registered_uid: null }
    };

    // Fast memory/storage cache for date ranges (e.g., full month attendance logs)
    this.rangeCache = {};

    // 1. Immediately restore persistent state from sessionStorage (0 milliseconds)
    this.loadPersistentCache();

    // 2. Initialize Supabase Client & Realtime WebSockets
    this.init();

    // 3. Tab visibility watcher to pause polling when hidden & sync on refocus
    if (typeof document !== "undefined") {
      document.addEventListener("visibilitychange", () => {
        if (!document.hidden && this.client) {
          this.executeSyncCycle();
        }
      });
    }
  }

  // ======================== PERSISTENT CLIENT STORAGE (SWR) ========================
  loadPersistentCache() {
    try {
      if (typeof sessionStorage === "undefined") return;
      const raw = sessionStorage.getItem("CAMPUSKEY_CACHE_V2");
      if (raw) {
        const parsed = JSON.parse(raw);
        if (parsed && typeof parsed === "object") {
          if (Array.isArray(parsed.users) && parsed.users.length > 0) {
            this.cachedState.users = parsed.users;
          }
          if (Array.isArray(parsed.todayAttendance)) {
            this.cachedState.todayAttendance = parsed.todayAttendance;
          }
          if (Array.isArray(parsed.errors)) {
            this.cachedState.errors = parsed.errors;
          }
          if (parsed.systemState && parsed.systemState.mode) {
            this.cachedState.systemState = parsed.systemState;
          }
          this.lastStateHash = parsed.lastStateHash || "";
          this.lastAttHash = parsed.lastAttHash || "";
          this.lastErrHash = parsed.lastErrHash || "";
          this.lastUserHash = parsed.lastUserHash || "";
          this.rangeCache = parsed.rangeCache || {};
        }
      }
    } catch (e) {
      console.warn("Storage load warning:", e);
    }
  }

  savePersistentCache() {
    try {
      if (typeof sessionStorage === "undefined") return;
      sessionStorage.setItem("CAMPUSKEY_CACHE_V2", JSON.stringify({
        users: this.cachedState.users,
        todayAttendance: this.cachedState.todayAttendance,
        errors: this.cachedState.errors,
        systemState: this.cachedState.systemState,
        lastStateHash: this.lastStateHash,
        lastAttHash: this.lastAttHash,
        lastErrHash: this.lastErrHash,
        lastUserHash: this.lastUserHash,
        rangeCache: this.rangeCache,
        savedAt: Date.now()
      }));
    } catch (e) {
      console.warn("Storage save warning:", e);
    }
  }

  init() {
    try {
      if (typeof window.supabase !== "undefined" && window.supabase.createClient) {
        this.client = window.supabase.createClient(
          CAMPUSKEY_CONFIG.SUPABASE_URL,
          CAMPUSKEY_CONFIG.SUPABASE_ANON_KEY,
          {
            auth: { persistSession: true, autoRefreshToken: true },
            realtime: { params: { eventsPerSecond: 10 } }
          }
        );
        this.isInitialized = true;
        this.setupRealtimeListeners();
        this.startHighFrequencySync();
      } else {
        setTimeout(() => this.init(), 200);
      }
    } catch (err) {
      console.error("Supabase init error:", err);
      this.startHighFrequencySync();
    }
  }

  // ======================== BACKGROUND REALTIME SYNC (4000ms + WebSocket) ========================
  startHighFrequencySync() {
    if (this.pollingTimer) clearInterval(this.pollingTimer);

    // Initial immediate background fetch (does not block instant cache render)
    this.executeSyncCycle();

    // Fallback heartbeat sync every 4000ms (Supabase Realtime WebSocket handles millisecond push updates)
    this.pollingTimer = setInterval(() => {
      if (typeof document !== "undefined" && document.hidden) return; // Skip if tab is in background
      this.executeSyncCycle();
    }, 4000);
  }

  async executeSyncCycle(force = false) {
    if (this.isPollingActive || !this.client) return;
    this.isPollingActive = true;

    try {
      const today = new Date().toISOString().split("T")[0];

      // Fetch all core telemetry streams IN PARALLEL (Promise.allSettled) to eliminate waterfall lag
      const [stateRes, attRes, errRes, usersRes] = await Promise.allSettled([
        // 1. System state
        this.client.from("system_state").select("*").eq("id", 1).single(),
        // 2. Today's attendance logs
        this.client.from("attendance_logs").select(`
          id,
          user_id,
          card_uid,
          scan_date,
          check_in_time,
          status,
          users:user_id (
            id,
            full_name,
            user_type,
            branch,
            course_or_role,
            enrollment_or_roll,
            mobile_number
          )
        `).eq("scan_date", today).order("check_in_time", { ascending: false }),
        // 3. Diagnostic error logs
        this.client.from("error_logs").select("*").order("created_at", { ascending: false }).limit(60),
        // 4. User directory
        this.client.from("users").select("*").order("created_at", { ascending: false })
      ]);

      let stateChanged = false;

      // 1. Process System State
      if (stateRes.status === "fulfilled" && !stateRes.value.error && stateRes.value.data) {
        const state = stateRes.value.data;
        const stateHash = `${state.mode}_${state.last_registered_uid}_${state.updated_at}`;
        if (stateHash !== this.lastStateHash || force) {
          stateChanged = true;
          this.lastStateHash = stateHash;
          this.cachedState.systemState = state;

          // Active Registration Hook: Detect newly captured card UID (Dispatch FIRST)
          if (state.last_registered_uid && state.last_registered_uid !== this.registrationBaselineUID) {
            this.registrationBaselineUID = state.last_registered_uid;
            this.notifySubscribers("CARD_CAPTURED", { card_uid: state.last_registered_uid });
          }

          this.notifySubscribers("SYSTEM_STATE_CHANGE", { new: state });
        }
      }

      // 2. Process Attendance Logs
      if (attRes.status === "fulfilled" && !attRes.value.error && attRes.value.data) {
        const attLogs = attRes.value.data;
        const attHash = `${attLogs.length}_${attLogs[0]?.id || ''}_${attLogs[0]?.check_in_time || ''}_${attLogs[0]?.status || ''}`;
        if (attHash !== this.lastAttHash || force) {
          stateChanged = true;
          const isNewScan = attLogs.length > (this.cachedState.todayAttendance?.length || 0);
          this.lastAttHash = attHash;
          this.cachedState.todayAttendance = attLogs;
          this.notifySubscribers("ATTENDANCE_CHANGE", {
            all: attLogs,
            new: isNewScan ? attLogs[0] : null
          });
        }
      }

      // 3. Process Diagnostic Error Logs
      if (errRes.status === "fulfilled" && !errRes.value.error && errRes.value.data) {
        const errLogs = errRes.value.data;
        const errHash = `${errLogs.length}_${errLogs[0]?.id || ''}_${errLogs[0]?.created_at || ''}`;
        if (errHash !== this.lastErrHash || force) {
          stateChanged = true;
          const isNewError = errLogs.length > (this.cachedState.errors?.length || 0);
          this.lastErrHash = errHash;
          this.cachedState.errors = errLogs;
          this.notifySubscribers("ERROR_LOG_CHANGE", {
            all: errLogs,
            new: isNewError ? errLogs[0] : null
          });
        }
      }

      // 4. Process Users
      if (usersRes.status === "fulfilled" && !usersRes.value.error && usersRes.value.data) {
        const userList = usersRes.value.data;
        const userHash = `${userList.length}_${userList[0]?.id || ''}_${userList[0]?.updated_at || ''}`;
        if (userHash !== this.lastUserHash || force) {
          stateChanged = true;
          this.lastUserHash = userHash;
          this.cachedState.users = userList;
          this.notifySubscribers("USERS_CHANGE", { all: userList, latest: userList[0] });

          if (userList[0] && userList[0].full_name?.startsWith("New Card (")) {
            this.notifySubscribers("CARD_CAPTURED", {
              card_uid: userList[0].card_uid,
              placeholder_user: userList[0]
            });
          }
        }
      }

      if (stateChanged) {
        this.savePersistentCache();
      }
    } catch (e) {
      // Non-blocking sync error
    } finally {
      this.isPollingActive = false;
    }
  }

  // ======================== INSTANT READ OPERATIONS (Cache-First SWR) ========================

  async getSystemState() {
    if (this.cachedState.systemState && this.cachedState.systemState.mode) {
      return this.cachedState.systemState;
    }
    if (!this.client) return { mode: "ATTENDANCE", last_registered_uid: null };
    try {
      const { data, error } = await this.client
        .from("system_state")
        .select("*")
        .eq("id", 1)
        .single();
      if (error) throw error;
      this.cachedState.systemState = data;
      this.savePersistentCache();
      return data;
    } catch (err) {
      return this.cachedState.systemState || { mode: "ATTENDANCE", last_registered_uid: null };
    }
  }

  async getUsers(filterType = "ALL", forceRefresh = false) {
    // 0ms Cache-First Hit: Return immediately if we already have users
    if (!forceRefresh && this.cachedState.users && this.cachedState.users.length > 0) {
      if (filterType === "ALL") return this.cachedState.users;
      return this.cachedState.users.filter(u => u.user_type === filterType);
    }

    if (!this.client) return this.cachedState.users || [];
    try {
      let query = this.client
        .from("users")
        .select("*")
        .order("created_at", { ascending: false });

      if (filterType !== "ALL") {
        query = query.eq("user_type", filterType);
      }

      const { data, error } = await query;
      if (error) throw error;

      if (filterType === "ALL") {
        this.cachedState.users = data || [];
        this.savePersistentCache();
      }
      return data || [];
    } catch (err) {
      return this.cachedState.users || [];
    }
  }

  async getTodayAttendance(forceRefresh = false) {
    // 0ms Cache-First Hit
    if (!forceRefresh && this.cachedState.todayAttendance && this.cachedState.todayAttendance.length > 0) {
      return this.cachedState.todayAttendance;
    }

    if (!this.client) return this.cachedState.todayAttendance || [];
    try {
      const today = new Date().toISOString().split("T")[0];
      const { data, error } = await this.client
        .from("attendance_logs")
        .select(`
          id,
          user_id,
          card_uid,
          scan_date,
          check_in_time,
          status,
          users:user_id (
            id,
            full_name,
            user_type,
            branch,
            course_or_role,
            enrollment_or_roll,
            mobile_number
          )
        `)
        .eq("scan_date", today)
        .order("check_in_time", { ascending: false });

      if (error) throw error;
      this.cachedState.todayAttendance = data || [];
      this.savePersistentCache();
      return data || [];
    } catch (err) {
      return this.cachedState.todayAttendance || [];
    }
  }

  async getAttendanceByDateRange(startDate, endDate, userType = "ALL") {
    const today = new Date().toISOString().split("T")[0];

    // 0ms Cache Hit: If querying today and we have todayAttendance cached
    if (startDate === today && endDate === today && userType === "ALL" && this.cachedState.todayAttendance?.length > 0) {
      return this.cachedState.todayAttendance;
    }

    // Fast Memory/Storage Cache for Range Queries (e.g. Month calculations)
    const cacheKey = `${startDate}_${endDate}_${userType}`;
    const cachedEntry = this.rangeCache[cacheKey];
    if (cachedEntry && (Date.now() - (cachedEntry.timestamp || 0) < 60000)) {
      return cachedEntry.data;
    }

    if (!this.client) return cachedEntry ? cachedEntry.data : [];
    try {
      let query = this.client
        .from("attendance_logs")
        .select(`
          id,
          user_id,
          card_uid,
          scan_date,
          check_in_time,
          status,
          users:user_id (
            id,
            full_name,
            user_type,
            branch,
            course_or_role,
            enrollment_or_roll,
            mobile_number
          )
        `)
        .gte("scan_date", startDate)
        .lte("scan_date", endDate)
        .order("check_in_time", { ascending: false });

      const { data, error } = await query;
      if (error) throw error;

      let filtered = data || [];
      if (userType !== "ALL") {
        filtered = filtered.filter(item => item.users && item.users.user_type === userType);
      }

      this.rangeCache[cacheKey] = {
        data: filtered,
        timestamp: Date.now()
      };
      this.savePersistentCache();

      return filtered;
    } catch (err) {
      console.error("Error fetching attendance range:", err);
      return cachedEntry ? cachedEntry.data : [];
    }
  }

  async getErrorLogs(limit = 100, forceRefresh = false) {
    // 0ms Cache Hit
    if (!forceRefresh && this.cachedState.errors && this.cachedState.errors.length > 0) {
      return this.cachedState.errors.slice(0, limit);
    }

    if (!this.client) return this.cachedState.errors || [];
    try {
      const { data, error } = await this.client
        .from("error_logs")
        .select("*")
        .order("created_at", { ascending: false })
        .limit(limit);

      if (error) throw error;
      this.cachedState.errors = data || [];
      this.savePersistentCache();
      return data || [];
    } catch (err) {
      return this.cachedState.errors || [];
    }
  }

  // ======================== MUTATION OPERATIONS ========================

  async setRegistrationMode(durationSeconds = 60) {
    if (!this.client) throw new Error("Database connection not ready");
    const expiresAt = new Date(Date.now() + durationSeconds * 1000).toISOString();

    // Reset baseline UID so any newly scanned card is immediately detected
    this.registrationBaselineUID = null;

    const { data, error } = await this.client
      .from("system_state")
      .update({
        mode: "REGISTRATION",
        mode_expires_at: expiresAt,
        last_registered_uid: null,
        updated_at: new Date().toISOString()
      })
      .eq("id", 1)
      .select();

    if (error) throw error;
    this.executeSyncCycle(true);
    return data;
  }

  async cancelRegistrationMode() {
    if (!this.client) return;
    this.registrationBaselineUID = null;
    const { data, error } = await this.client
      .from("system_state")
      .update({
        mode: "ATTENDANCE",
        mode_expires_at: null,
        updated_at: new Date().toISOString()
      })
      .eq("id", 1)
      .select();

    if (!error) {
      this.executeSyncCycle(true);
    }
    return data;
  }

  async saveRegisteredUserProfile(userData) {
    if (!this.client) throw new Error("Database not ready");
    const cleanUID = userData.card_uid.trim().toUpperCase();

    // 1. Check if a placeholder user row was created by handle_card_scan
    const { data: existingUser } = await this.client
      .from("users")
      .select("id")
      .eq("card_uid", cleanUID)
      .maybeSingle();

    let savedUser = null;

    if (existingUser) {
      const { data, error } = await this.client
        .from("users")
        .update({
          user_type: userData.user_type,
          full_name: userData.full_name,
          branch: userData.branch,
          course_or_role: userData.course_or_role,
          enrollment_or_roll: userData.enrollment_or_roll,
          mobile_number: userData.mobile_number,
          is_active: true
        })
        .eq("id", existingUser.id)
        .select()
        .single();

      if (error) throw error;
      savedUser = data;
    } else {
      const { data, error } = await this.client
        .from("users")
        .insert([
          {
            card_uid: cleanUID,
            user_type: userData.user_type,
            full_name: userData.full_name,
            branch: userData.branch,
            course_or_role: userData.course_or_role,
            enrollment_or_roll: userData.enrollment_or_roll,
            mobile_number: userData.mobile_number,
            is_active: true
          }
        ])
        .select()
        .single();

      if (error) throw error;
      savedUser = data;
    }

    // 2. Set system_state back to ATTENDANCE and record last_registered_uid
    await this.client
      .from("system_state")
      .update({
        mode: "ATTENDANCE",
        mode_expires_at: null,
        last_registered_uid: cleanUID,
        updated_at: new Date().toISOString()
      })
      .eq("id", 1);

    this.registrationBaselineUID = cleanUID;

    // Optimistic update of cached users list for instant UI feedback
    if (this.cachedState.users && savedUser) {
      const idx = this.cachedState.users.findIndex(u => u.card_uid === cleanUID || u.id === savedUser.id);
      if (idx >= 0) {
        this.cachedState.users[idx] = savedUser;
      } else {
        this.cachedState.users.unshift(savedUser);
      }
      this.savePersistentCache();
      this.notifySubscribers("USERS_CHANGE", { all: this.cachedState.users, latest: savedUser });
    }

    this.executeSyncCycle(true);
    return savedUser;
  }

  async updateUser(userId, userData) {
    if (!this.client) throw new Error("Database not connected");
    const payload = { ...userData };
    if (payload.card_uid) {
      payload.card_uid = payload.card_uid.trim().toUpperCase();
    }
    const { data, error } = await this.client
      .from("users")
      .update(payload)
      .eq("id", userId)
      .select()
      .single();

    if (error) throw error;
    this.executeSyncCycle(true);
    return data;
  }

  async deleteUser(userId) {
    if (!this.client) throw new Error("Database not connected");

    // Instant Optimistic Update (0ms)
    if (this.cachedState.users) {
      this.cachedState.users = this.cachedState.users.filter(u => u.id !== userId);
      this.savePersistentCache();
      this.notifySubscribers("USERS_CHANGE", { all: this.cachedState.users });
    }

    const { error } = await this.client
      .from("users")
      .delete()
      .eq("id", userId);

    if (error) {
      this.executeSyncCycle(true);
      throw error;
    }
    return true;
  }

  async manualMarkAttendance(userId, cardUid, scanDate, status = "PRESENT") {
    if (!this.client) throw new Error("Database not connected");
    const targetDate = scanDate || new Date().toISOString().split("T")[0];

    // Instant Optimistic Update (0ms badge switch)
    const targetUser = (this.cachedState.users || []).find(u => u.id === userId);
    const existingIndex = (this.cachedState.todayAttendance || []).findIndex(
      l => l.user_id === userId && l.scan_date === targetDate
    );

    if (existingIndex >= 0) {
      this.cachedState.todayAttendance[existingIndex].status = status;
      this.cachedState.todayAttendance[existingIndex].check_in_time = new Date().toISOString();
    } else if (targetUser) {
      this.cachedState.todayAttendance.unshift({
        id: "temp_" + Date.now(),
        user_id: userId,
        card_uid: cardUid,
        scan_date: targetDate,
        check_in_time: new Date().toISOString(),
        status: status,
        users: targetUser
      });
    }

    // Invalidate rangeCache for attendance
    this.rangeCache = {};
    this.savePersistentCache();
    this.notifySubscribers("ATTENDANCE_CHANGE", { all: this.cachedState.todayAttendance });

    // Background DB operation
    const { data: existing } = await this.client
      .from("attendance_logs")
      .select("id")
      .eq("user_id", userId)
      .eq("scan_date", targetDate)
      .maybeSingle();

    if (existing) {
      const { data, error } = await this.client
        .from("attendance_logs")
        .update({ status: status, check_in_time: new Date().toISOString() })
        .eq("id", existing.id)
        .select();
      if (error) {
        this.executeSyncCycle(true);
        throw error;
      }
      return data;
    } else {
      const { data, error } = await this.client
        .from("attendance_logs")
        .insert([
          {
            user_id: userId,
            card_uid: cardUid,
            scan_date: targetDate,
            check_in_time: new Date().toISOString(),
            status: status
          }
        ])
        .select();
      if (error) {
        this.executeSyncCycle(true);
        throw error;
      }
      return data;
    }
  }

  async deleteAttendanceLog(logId) {
    if (!this.client) throw new Error("Database not connected");

    // Instant Optimistic Update (0ms)
    if (this.cachedState.todayAttendance) {
      this.cachedState.todayAttendance = this.cachedState.todayAttendance.filter(l => l.id !== logId);
      this.rangeCache = {};
      this.savePersistentCache();
      this.notifySubscribers("ATTENDANCE_CHANGE", { all: this.cachedState.todayAttendance });
    }

    const { error } = await this.client
      .from("attendance_logs")
      .delete()
      .eq("id", logId);

    if (error) {
      this.executeSyncCycle(true);
      throw error;
    }
    return true;
  }

  async clearErrorLogs() {
    if (!this.client) throw new Error("Database not connected");

    // Instant Optimistic Update (0ms wipe)
    this.cachedState.errors = [];
    this.savePersistentCache();
    this.notifySubscribers("ERROR_LOG_CHANGE", { all: [] });

    const { error } = await this.client
      .from("error_logs")
      .delete()
      .neq("id", "00000000-0000-0000-0000-000000000000");

    if (error) {
      this.executeSyncCycle(true);
      throw error;
    }
    return true;
  }

  // ======================== SUBSCRIBERS ========================
  subscribe(callback) {
    this.realtimeSubscribers.push(callback);
  }

  unsubscribe(callback) {
    this.realtimeSubscribers = this.realtimeSubscribers.filter(cb => cb !== callback);
  }

  notifySubscribers(eventType, payload) {
    this.realtimeSubscribers.forEach(cb => {
      try {
        cb(eventType, payload);
      } catch (e) {
        console.error("Subscriber notification error:", e);
      }
    });
  }

  setupRealtimeListeners() {
    if (!this.client) return;
    try {
      const debouncedSync = () => {
        if (this.syncDebounceTimer) clearTimeout(this.syncDebounceTimer);
        this.syncDebounceTimer = setTimeout(() => {
          this.executeSyncCycle(true);
        }, 120);
      };

      this.client
        .channel("campuskey_db_stream")
        .on("postgres_changes", { event: "*", schema: "public", table: "attendance_logs" }, debouncedSync)
        .on("postgres_changes", { event: "*", schema: "public", table: "system_state" }, debouncedSync)
        .on("postgres_changes", { event: "*", schema: "public", table: "error_logs" }, debouncedSync)
        .on("postgres_changes", { event: "*", schema: "public", table: "users" }, debouncedSync)
        .subscribe();
    } catch (e) {}
  }
}

// Global Singleton
const campusKey = new CampusKeyDataService();
