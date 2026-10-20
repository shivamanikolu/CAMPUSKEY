/**
 * CAMPUSKEY — ISOLATED AUTHENTICATION & SESSION MANAGEMENT
 * Supabase Auth Guard, Anti-Flash Protection & Secure Session Engine
 */

(function () {
  "use strict";

  // 1. Synchronous anti-flash guard on protected routes
  const currentPath = window.location.pathname.toLowerCase().replace(/\/$/, "");
  const isLoginPage = currentPath.endsWith("login.html") || currentPath.endsWith("/login") || currentPath === "/login" || currentPath === "login";

  if (!isLoginPage) {
    if (!document.getElementById("ck-auth-guard-style")) {
      const style = document.createElement("style");
      style.id = "ck-auth-guard-style";
      style.textContent = `
        html:not(.auth-verified) body {
          visibility: hidden !important;
          opacity: 0 !important;
        }
      `;
      (document.head || document.documentElement).appendChild(style);
    }
  }

  // 2. Safe Internal Redirect Sanitizer (Prevents Open Redirect Vulnerabilities)
  function getSafeRedirectUrl() {
    try {
      const params = new URLSearchParams(window.location.search);
      const raw = params.get("redirect");
      if (!raw) return "index.html";

      // Disallow external URLs (must not start with http://, https://, //, or contain colons)
      if (raw.startsWith("http://") || raw.startsWith("https://") || raw.startsWith("//") || raw.includes(":")) {
        return "index.html";
      }

      // Allowed internal destinations (supports both clean URLs and .html extensions)
      const allowed = [
        "index.html", "attendance.html", "users.html", "errors.html",
        "index", "attendance", "users", "errors"
      ];
      const cleanPath = raw.split("?")[0].split("/").pop();
      if (allowed.includes(cleanPath)) {
        return raw;
      }
      return "index.html";
    } catch (e) {
      return "index.html";
    }
  }

  // 3. Obtain or initialize isolated Supabase Auth Client
  function getAuthClient() {
    if (typeof window.campusKey !== "undefined" && window.campusKey.client) {
      return window.campusKey.client;
    }

    if (typeof window.supabase !== "undefined" && window.supabase.createClient) {
      const url = (typeof CAMPUSKEY_CONFIG !== "undefined" && CAMPUSKEY_CONFIG.SUPABASE_URL) || "https://qnuewgwuiubpdlnatuez.supabase.co";
      const key = (typeof CAMPUSKEY_CONFIG !== "undefined" && CAMPUSKEY_CONFIG.SUPABASE_ANON_KEY) || "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InFudWV3Z3d1aXVicGRsbmF0dWV6Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3OTI0NjM0NjUsImV4cCI6MjEwODAzOTQ2NX0.d6NxbXEw-X5rUmEe59nEGj9kvdSSky1SlNUen-3K6kI";
      return window.supabase.createClient(url, key, {
        auth: { persistSession: true, autoRefreshToken: true }
      });
    }
    return null;
  }

  // 4. Inject Minimalist Sign Out Button into Existing Navbar
  function injectSignOutButton(client) {
    function tryInject() {
      const controls = document.querySelector("#main-navbar .nav-controls");
      if (!controls) return false;
      if (document.getElementById("btn-nav-signout")) return true;

      const signOutBtn = document.createElement("button");
      signOutBtn.id = "btn-nav-signout";
      signOutBtn.className = "btn-signout";
      signOutBtn.setAttribute("type", "button");
      signOutBtn.setAttribute("title", "Sign out of administrative session");
      signOutBtn.innerHTML = `
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
          <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"></path>
          <polyline points="16 17 21 12 16 7"></polyline>
          <line x1="21" y1="12" x2="9" y2="12"></line>
        </svg>
        <span>Sign Out</span>
      `;

      signOutBtn.addEventListener("click", async function (e) {
        e.preventDefault();
        signOutBtn.disabled = true;
        signOutBtn.style.opacity = "0.5";
        await handleSignOut(client);
      });

      controls.appendChild(signOutBtn);
      return true;
    }

    if (!tryInject()) {
      let attempts = 0;
      const interval = setInterval(() => {
        attempts++;
        if (tryInject() || attempts > 25) {
          clearInterval(interval);
        }
      }, 100);
    }
  }

  // 5. Sign Out Handler
  async function handleSignOut(client) {
    try {
      if (client && client.auth) {
        await client.auth.signOut();
      }
    } catch (e) {
      console.warn("Sign-out warning:", e);
    } finally {
      try {
        if (typeof sessionStorage !== "undefined") {
          sessionStorage.removeItem("CAMPUSKEY_CACHE_V2");
        }
      } catch (e) {}
      window.location.replace("login.html");
    }
  }

  // 6. Route Guard for Protected Application Pages
  async function guardProtectedPage(client) {
    try {
      const { data, error } = await client.auth.getSession();
      const session = data && data.session;

      if (error || !session || !session.user) {
        // Unauthenticated access -> fail closed, redirect to login
        try {
          if (typeof sessionStorage !== "undefined") {
            sessionStorage.removeItem("CAMPUSKEY_CACHE_V2");
          }
        } catch (e) {}

        const target = window.location.pathname.split("/").pop() || "index.html";
        window.location.replace("login.html?redirect=" + encodeURIComponent(target + window.location.search));
        return;
      }

      // Session verified -> reveal application DOM
      document.documentElement.classList.add("auth-verified");

      // Set up sign-out in navbar
      injectSignOutButton(client);

      // Listen for background session expiration or logout
      client.auth.onAuthStateChange((event, newSession) => {
        if (event === "SIGNED_OUT" || !newSession) {
          try {
            if (typeof sessionStorage !== "undefined") {
              sessionStorage.removeItem("CAMPUSKEY_CACHE_V2");
            }
          } catch (e) {}
          window.location.replace("login.html");
        }
      });
    } catch (err) {
      console.error("Auth verification failed:", err);
      window.location.replace("login.html");
    }
  }

  // 7. Login Page Controller
  async function initLoginPage(client) {
    // If user already holds a valid session, skip login form
    try {
      const { data } = await client.auth.getSession();
      if (data && data.session && data.session.user) {
        window.location.replace(getSafeRedirectUrl());
        return;
      }
    } catch (e) {}

    const form = document.getElementById("login-form");
    const emailInput = document.getElementById("login-email");
    const passwordInput = document.getElementById("login-password");
    const submitBtn = document.getElementById("login-submit-btn");
    const alertBox = document.getElementById("login-alert");
    const alertText = document.getElementById("login-alert-text");
    const togglePassBtn = document.getElementById("btn-toggle-password");
    const forgotPassBtn = document.getElementById("btn-forgot-password");

    function showAlert(message, type = "error") {
      if (!alertBox || !alertText) return;
      alertBox.className = "auth-alert visible auth-alert-" + type;
      alertText.textContent = message;
    }

    function clearAlert() {
      if (!alertBox) return;
      alertBox.className = "auth-alert";
    }

    // Password visibility toggle
    if (togglePassBtn && passwordInput) {
      togglePassBtn.addEventListener("click", function () {
        const isPassword = passwordInput.getAttribute("type") === "password";
        passwordInput.setAttribute("type", isPassword ? "text" : "password");
        togglePassBtn.setAttribute("aria-label", isPassword ? "Hide password" : "Show password");
        togglePassBtn.innerHTML = isPassword
          ? `<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2"><path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24"></path><line x1="1" y1="1" x2="23" y2="23"></line></svg>`
          : `<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"></path><circle cx="12" cy="12" r="3"></circle></svg>`;
      });
    }

    // Form submission
    if (form) {
      form.addEventListener("submit", async function (e) {
        e.preventDefault();
        clearAlert();

        const email = emailInput ? emailInput.value.trim() : "";
        const password = passwordInput ? passwordInput.value : "";

        if (!email || !password) {
          showAlert("Please enter both email and password.");
          return;
        }

        // Set button loading state
        if (submitBtn) {
          submitBtn.disabled = true;
          submitBtn.innerHTML = `<span class="auth-spinner"></span><span>Verifying credentials...</span>`;
        }

        try {
          const { data, error } = await client.auth.signInWithPassword({
            email: email,
            password: password
          });

          if (error) {
            // Provide clean generic feedback to prevent credential enumeration
            showAlert("Invalid email or password. Please verify your credentials.");
            if (submitBtn) {
              submitBtn.disabled = false;
              submitBtn.innerHTML = `<span>Sign In</span>`;
            }
            return;
          }

          if (data && data.session) {
            if (submitBtn) {
              submitBtn.innerHTML = `<span>Authenticated. Redirecting...</span>`;
            }
            window.location.replace(getSafeRedirectUrl());
          }
        } catch (err) {
          console.error("Login attempt failed:", err);
          showAlert("Connection failure. Unable to reach authentication server.");
          if (submitBtn) {
            submitBtn.disabled = false;
            submitBtn.innerHTML = `<span>Sign In</span>`;
          }
        }
      });
    }

    // Password reset / recovery request
    if (forgotPassBtn) {
      forgotPassBtn.addEventListener("click", async function (e) {
        e.preventDefault();
        const email = emailInput ? emailInput.value.trim() : "";
        if (!email) {
          showAlert("Enter your email address in the field above to request password reset.", "info");
          if (emailInput) emailInput.focus();
          return;
        }

        try {
          const { error } = await client.auth.resetPasswordForEmail(email, {
            redirectTo: window.location.origin + "/login.html"
          });
          if (error) {
            showAlert("Password reset request failed: " + error.message, "error");
          } else {
            showAlert("If an authorized account is associated with this email, password recovery instructions have been dispatched.", "success");
          }
        } catch (err) {
          showAlert("Unable to process password reset request at this time.", "error");
        }
      });
    }
  }

  // 8. Main Entrypoint Initialization
  function init() {
    const client = getAuthClient();
    if (!client) {
      // Retry if Supabase CDN library is still loading
      setTimeout(init, 50);
      return;
    }

    if (isLoginPage) {
      initLoginPage(client);
    } else {
      guardProtectedPage(client);
    }
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }

  // Expose global namespace for manual operations
  window.CampusKeyAuth = {
    signOut: function () {
      const client = getAuthClient();
      return handleSignOut(client);
    }
  };
})();
