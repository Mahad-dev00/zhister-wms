const { runSync } = require("../../lib/zhipster-sync");

module.exports = async function handler(req, res) {
  if (req.method !== "GET" && req.method !== "POST") {
    res.setHeader("Allow", "GET, POST");
    return res.status(405).json({ error: "Method not allowed" });
  }

  const expected = process.env.CRON_SECRET;
  const authorization = String(req.headers.authorization || "");
  const supplied = authorization.startsWith("Bearer ") ? authorization.slice(7) : String(req.headers["x-cron-secret"] || "");
  if (!expected || supplied !== expected) {
    return res.status(401).json({ error: "Unauthorized" });
  }

  try {
    const result = await runSync();
    return res.status(200).json(result);
  } catch (error) {
    return res.status(502).json({ status: "failed", error: error.message || "Automatic Zhipster sync failed." });
  }
};
