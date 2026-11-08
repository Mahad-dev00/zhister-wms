const { getVerifiedAdmin, originAllowed } = require("../../lib/auth");

const ADMIN_EMAIL = "mahad.warsame.work@gmail.com";

async function requireAdmin(req, res) {
  const user = await getVerifiedAdmin(req, res, true);
  if (!user || !user.email_confirmed_at || String(user.email || "").toLowerCase() !== ADMIN_EMAIL) {
    res.status(401).json({ error: "Sign in with the authorised WMS administrator account." });
    return null;
  }
  return user;
}

async function rpc(name, body = {}) {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error("WMS database integration is not configured in this Preview environment.");
  const response = await fetch(`${url.replace(/\/$/, "")}/rest/v1/rpc/${name}`, {
    method: "POST",
    headers: {
      apikey: key,
      Authorization: `Bearer ${key}`,
      "Content-Type": "application/json",
      Accept: "application/json"
    },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(15000)
  });
  const raw = await response.text();
  let data;
  try { data = raw ? JSON.parse(raw) : null; } catch { data = null; }
  if (!response.ok) throw new Error(`WMS database request failed (HTTP ${response.status}).`);
  return data;
}

module.exports = async function handler(req, res) {
  res.setHeader("Cache-Control", "no-store, max-age=0");
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  if (req.method !== "GET" && req.method !== "POST") {
    res.setHeader("Allow", "GET, POST");
    return res.status(405).json({ error: "Method not allowed" });
  }

  try {
    const user = await requireAdmin(req, res);
    if (!user) return;

    if (req.method === "GET") {
      const [inventory, movements, catalogue] = await Promise.all([
        rpc("list_wms_inventory"),
        rpc("list_wms_stock_movements"),
        rpc("list_wms_stock_article_catalog")
      ]);
      return res.status(200).json({
        inventory: Array.isArray(inventory) ? inventory : [],
        movements: Array.isArray(movements) ? movements : [],
        catalogue: Array.isArray(catalogue) ? catalogue : []
      });
    }

    if (!originAllowed(req)) {
      return res.status(403).json({ error: "Request origin is not allowed." });
    }

    const body = typeof req.body === "string" ? JSON.parse(req.body || "{}") : (req.body || {});
    const articleCode = String(body.articleCode || "").trim();
    const locationCode = String(body.locationCode || "").trim();
    const movementType = String(body.movementType || "");
    const quantityDelta = Number(body.quantityDelta);
    if (!/^[A-Za-z0-9._-]{1,80}$/.test(articleCode) ||
        !/^[A-Za-z0-9._-]{1,40}$/.test(locationCode) ||
        !["receipt", "adjustment"].includes(movementType) ||
        !Number.isFinite(quantityDelta) || quantityDelta === 0 ||
        (movementType === "receipt" && quantityDelta < 0) ||
        Math.abs(quantityDelta) > 1000000) {
      return res.status(400).json({ error: "Enter a valid article, active location, movement type and non-zero quantity." });
    }

    const result = await rpc("record_wms_stock_movement", {
      p_article_code: articleCode,
      p_location_code: locationCode,
      p_quantity_delta: quantityDelta,
      p_movement_type: movementType,
      p_reference: String(body.reference || "").slice(0, 120),
      p_note: String(body.note || "").slice(0, 500),
      p_actor: user.id
    });
    return res.status(200).json({ ok: true, result });
  } catch (error) {
    const message = error && error.message ? error.message : "Could not complete the stock request.";
    const status = /temporarily unavailable|service/i.test(message) ? 503 : 502;
    return res.status(status).json({ error: message });
  }
};
