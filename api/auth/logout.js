const { authRequest, cookieValue, clearSessionCookies, originAllowed } = require("../_auth");

module.exports = async function handler(req, res) {
  res.setHeader("Cache-Control", "no-store");
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  if (req.method !== "POST") { res.setHeader("Allow", "POST"); return res.status(405).json({ error: "Method not allowed" }); }
  if (!originAllowed(req)) return res.status(403).json({ error: "Request origin is not allowed." });
  const access = cookieValue(req, "__Host-wms_access");
  if (access) {
    try { await authRequest("logout", { method: "POST", headers: { Authorization: `Bearer ${access}` }, body: "{}" }); } catch {}
  }
  clearSessionCookies(res);
  return res.status(200).json({ ok: true });
};
