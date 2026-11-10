const { getVerifiedAdmin, originAllowed } = require("../../lib/auth");
const { runSync } = require("../../lib/zhipster-sync");

const ADMIN_EMAIL = "mahad.warsame.work@gmail.com";

module.exports = async function handler(req, res) {
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return res.status(405).json({ error: "Method not allowed" });
  }
  if (!originAllowed(req)) return res.status(403).json({ error: "Request origin is not allowed." });

  const user = await getVerifiedAdmin(req, res, true);
  if (!user || !user.email_confirmed_at || String(user.email || "").toLowerCase() !== ADMIN_EMAIL) {
    return res.status(401).json({ error: "Sign in with the authorised WMS administrator account." });
  }

  try {
    return res.status(200).json(await runSync());
  } catch (error) {
    return res.status(502).json({ status: "failed", error: error.message || "Zhipster sync failed." });
  }
};
