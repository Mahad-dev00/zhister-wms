(() => {
  const gate = document.getElementById("authGate");
  const form = document.getElementById("authForm");
  const message = document.getElementById("authMessage");
  const submit = document.getElementById("authSubmit");
  const modeButton = document.getElementById("authModeToggle");
  const password = document.getElementById("authPassword");
  let mode = "login";

  function showMessage(text, error = false) {
    message.textContent = text;
    message.dataset.error = error ? "true" : "false";
    message.hidden = !text;
  }
  function setMode(next) {
    mode = next;
    document.getElementById("authHeading").textContent = mode === "login" ? "Sign in to Zhister" : "Create administrator account";
    document.getElementById("authIntro").textContent = mode === "login"
      ? "Use your verified administrator email and password."
      : "Create the designated administrator account. Email verification is required before sign-in.";
    submit.textContent = mode === "login" ? "Sign in" : "Create account";
    modeButton.textContent = mode === "login" ? "First time here? Create your account" : "Already registered? Sign in";
    password.autocomplete = mode === "login" ? "current-password" : "new-password";
    password.minLength = mode === "login" ? 1 : 12;
    showMessage("");
  }
  function enterApp(user) {
    document.body.classList.add("authenticated");
    gate.hidden = true;
    const meta = document.querySelector(".user-meta");
    if (meta) meta.innerHTML = "<strong>Mahad</strong><small>WMS administrator</small>";
    const crumb = document.querySelector(".top-actions");
    if (crumb && !document.getElementById("authSignOut")) {
      const button = document.createElement("button");
      button.id = "authSignOut";
      button.className = "btn subtle";
      button.type = "button";
      button.textContent = "Sign out";
      crumb.appendChild(button);
      button.addEventListener("click", async () => {
        button.disabled = true;
        try { await fetch("/api/auth/logout", { method: "POST", credentials: "same-origin" }); }
        finally { location.reload(); }
      });
    }
  }

  modeButton.addEventListener("click", () => setMode(mode === "login" ? "signup" : "login"));
  form.addEventListener("submit", async event => {
    event.preventDefault();
    const email = document.getElementById("authEmail").value.trim();
    const pass = password.value;
    submit.disabled = true;
    submit.textContent = mode === "login" ? "Signing in…" : "Creating account…";
    showMessage("");
    try {
      const response = await fetch(mode === "login" ? "/api/auth/login" : "/api/auth/signup", {
        method: "POST",
        credentials: "same-origin",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, password: pass })
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data.error || "Authentication request failed.");
      if (mode === "signup") {
        showMessage(data.message || "Check your email to confirm your account.");
        setMode("login");
        showMessage(data.message || "Check your email to confirm your account.");
      } else {
        location.reload();
      }
    } catch (error) {
      showMessage(error.message || "Could not sign in. Try again.", true);
    } finally {
      submit.disabled = false;
      submit.textContent = mode === "login" ? "Sign in" : "Create account";
    }
  });

  (async () => {
    try {
      const response = await fetch("/api/auth/session", { credentials: "same-origin", cache: "no-store" });
      const data = await response.json();
      if (response.ok && data.authenticated) enterApp(data.user);
      else gate.hidden = false;
    } catch {
      gate.hidden = false;
      showMessage("Cannot reach the authentication service. Check the Preview deployment configuration.", true);
    }
  })();
  setMode("login");
})();