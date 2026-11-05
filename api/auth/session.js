const { getVerifiedAdmin, clearSessionCookies } = require("../_auth");

module.exports = async function handler(req, res) {
  res.setHeader("Cache-Control", "no-store");
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  if (req.method !== "GET") { res.setHeader("Allow", "GET"); return res.status(405).json({ error: "Method not allowed" }); }
  try {
    const user = await getVerifiedAdmin(req, res, true);
    if (!user || !user.email_confirmed_at) {
      clearSessionCookies(res);
      return res.status(401).json({ authenticated: false });
    }
    return res.status(200).json({ authenticated: true, user: { email: user.email, displayName: "Mahad" } });
  } catch {
    return res.status(503).json({ authenticated: false, error: "Authentication service is temporarily unavailable." });
  }
};
