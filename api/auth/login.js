const { ADMIN_EMAIL, authRequest, originAllowed, setSessionCookies } = require("../_auth");

module.exports = async function handler(req, res) {
  res.setHeader("Cache-Control", "no-store");
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  if (req.method !== "POST") { res.setHeader("Allow", "POST"); return res.status(405).json({ error: "Method not allowed" }); }
  if (!originAllowed(req)) return res.status(403).json({ error: "Request origin is not allowed." });

  const email = String(req.body?.email || "").trim().toLowerCase();
  const password = String(req.body?.password || "");
  if (email !== ADMIN_EMAIL) return res.status(403).json({ error: "This WMS account is not authorised." });
  if (!password || password.length > 128) return res.status(400).json({ error: "Enter your password." });

  try {
    const { response, data } = await authRequest("token?grant_type=password", {
      method: "POST", body: JSON.stringify({ email, password })
    });
    if (!response.ok || !data.access_token || !data.user) {
      return res.status(401).json({ error: "Sign-in failed. Check your password and confirm your email address." });
    }
    if (String(data.user.email || "").toLowerCase() !== ADMIN_EMAIL || !data.user.email_confirmed_at) {
      return res.status(403).json({ error: "Administrator access requires a verified email address." });
    }
    setSessionCookies(res, data);
    return res.status(200).json({ ok: true, user: { email: ADMIN_EMAIL, displayName: "Mahad" } });
  } catch {
    return res.status(502).json({ error: "Could not reach the authentication service." });
  }
};
