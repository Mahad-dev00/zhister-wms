const { ADMIN_EMAIL, authRequest, originAllowed } = require("../../lib/auth");

module.exports = async function handler(req, res) {
  res.setHeader("Cache-Control", "no-store");
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  if (req.method !== "POST") { res.setHeader("Allow", "POST"); return res.status(405).json({ error: "Method not allowed" }); }
  if (!originAllowed(req)) return res.status(403).json({ error: "Request origin is not allowed." });

  const email = String(req.body?.email || "").trim().toLowerCase();
  const password = String(req.body?.password || "");
  if (email !== ADMIN_EMAIL) return res.status(403).json({ error: "This WMS is currently restricted to its designated administrator." });
  if (password.length < 12 || password.length > 128) return res.status(400).json({ error: "Use a password between 12 and 128 characters." });

  try {
    const redirectTo = new URL(req.headers.origin).origin + "/";
    const { response, data } = await authRequest("signup?redirect_to=" + encodeURIComponent(redirectTo), {
      method: "POST",
      body: JSON.stringify({
        email, password,
        data: { display_name: "Mahad" },
        gotrue_meta_security: { captcha_token: null }
      })
    });
    if (!response.ok) {
      const message = data.msg || data.message || data.error_description || data.error;
      if (response.status === 422 && /already|registered/i.test(String(message))) {
        return res.status(409).json({ error: "An account for this email already exists. Sign in instead." });
      }
      return res.status(response.status >= 400 && response.status < 500 ? response.status : 502)
        .json({ error: "Supabase could not create the administrator account. Check Auth email settings and try again." });
    }
    return res.status(200).json({ ok: true, message: "Account created. Check your email and confirm the address before signing in." });
  } catch {
    return res.status(502).json({ error: "Could not reach the authentication service." });
  }
};
