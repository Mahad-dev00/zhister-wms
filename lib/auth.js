const ADMIN_EMAIL = "mahad.warsame.work@gmail.com";

function config() {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_PUBLISHABLE_KEY;
  if (!url || !key) throw new Error("Supabase Preview environment is not configured.");
  return { url: url.replace(/\/$/, ""), key };
}

function cookieValue(req, name) {
  const header = req.headers.cookie || "";
  for (const part of header.split(";")) {
    const i = part.indexOf("=");
    if (i < 0) continue;
    if (part.slice(0, i).trim() === name) return decodeURIComponent(part.slice(i + 1).trim());
  }
  return "";
}

function setSessionCookies(res, session) {
  const secure = process.env.NODE_ENV === "production" ? "; Secure" : "";
  const accessAge = Math.max(60, Number(session.expires_in) || 3600);
  res.setHeader("Set-Cookie", [
    `__Host-wms_access=${encodeURIComponent(session.access_token)}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${accessAge}${secure}`,
    `__Host-wms_refresh=${encodeURIComponent(session.refresh_token)}; Path=/; HttpOnly; SameSite=Lax; Max-Age=2592000${secure}`
  ]);
}

function clearSessionCookies(res) {
  const secure = process.env.NODE_ENV === "production" ? "; Secure" : "";
  res.setHeader("Set-Cookie", [
    `__Host-wms_access=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0${secure}`,
    `__Host-wms_refresh=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0${secure}`
  ]);
}

function originAllowed(req) {
  const origin = req.headers.origin;
  if (!origin) return false;
  try {
    const parsed = new URL(origin);
    const host = req.headers.host;
    const sameOrigin = parsed.host === host && (parsed.protocol === "https:" || parsed.hostname === "localhost");
    const configuredFrontend = process.env.WMS_FRONTEND_ORIGIN;
    if (configuredFrontend) {
      try {
        const allowed = new URL(configuredFrontend);
        if (parsed.origin === allowed.origin && allowed.protocol === "https:") return true;
      } catch { /* Ignore invalid deployment configuration and retain same-origin checks. */ }
    }
    return sameOrigin;
  } catch { return false; }
}

async function authRequest(path, options = {}) {
  const { url, key } = config();
  const response = await fetch(`${url}/auth/v1/${path}`, {
    ...options,
    headers: {
      apikey: key,
      Accept: "application/json",
      "Content-Type": "application/json",
      ...(options.headers || {})
    },
    signal: AbortSignal.timeout(12000)
  });
  const raw = await response.text();
  let data = {};
  try { data = raw ? JSON.parse(raw) : {}; } catch {}
  return { response, data };
}

async function getVerifiedAdmin(req, res, allowRefresh = true) {
  const access = cookieValue(req, "__Host-wms_access");
  const refresh = cookieValue(req, "__Host-wms_refresh");
  if (!access && !refresh) return null;

  if (access) {
    const result = await authRequest("user", { headers: { Authorization: `Bearer ${access}` } });
    if (result.response.ok && String(result.data.email || "").toLowerCase() === ADMIN_EMAIL) {
      return result.data;
    }
  }

  if (!allowRefresh || !refresh) {
    clearSessionCookies(res);
    return null;
  }

  const refreshed = await authRequest("token?grant_type=refresh_token", {
    method: "POST",
    body: JSON.stringify({ refresh_token: refresh })
  });
  if (!refreshed.response.ok || !refreshed.data.access_token ||
      String(refreshed.data.user?.email || "").toLowerCase() !== ADMIN_EMAIL) {
    clearSessionCookies(res);
    return null;
  }
  setSessionCookies(res, refreshed.data);
  return refreshed.data.user;
}

module.exports = {
  ADMIN_EMAIL, config, authRequest, cookieValue, setSessionCookies,
  clearSessionCookies, originAllowed, getVerifiedAdmin
};
