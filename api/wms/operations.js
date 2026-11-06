const { getVerifiedAdmin, originAllowed } = require("../../lib/auth");

const ADMIN_EMAIL = "mahad.warsame.work@gmail.com";
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function config() {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error("WMS database integration is not configured.");
  return { url: url.replace(/\/$/, ""), key };
}

async function rpc(name, body) {
  const { url, key } = config();
  const response = await fetch(url + "/rest/v1/rpc/" + name, {
    method: "POST",
    headers: {
      apikey: key,
      Authorization: "Bearer " + key,
      "Content-Type": "application/json",
      Accept: "application/json"
    },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(15000)
  });
  const raw = await response.text();
  let data = null;
  try { data = raw ? JSON.parse(raw) : null; } catch (_) {}
  if (!response.ok) {
    const message = data && data.message ? data.message : "Warehouse operation failed.";
    throw new Error(message);
  }
  return data;
}

module.exports = async function handler(req, res) {
  res.setHeader("Cache-Control", "no-store, max-age=0");
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return res.status(405).json({ error: "Method not allowed" });
  }
  if (!originAllowed(req)) return res.status(403).json({ error: "Request origin is not allowed." });

  try {
    const user = await getVerifiedAdmin(req, res, true);
    if (!user || !user.email_confirmed_at || String(user.email || "").toLowerCase() !== ADMIN_EMAIL) {
      return res.status(401).json({ error: "Sign in with the authorised WMS administrator account." });
    }

    const body = typeof req.body === "string" ? JSON.parse(req.body || "{}") : (req.body || {});
    const actor = user.id;
    let result;

    if (body.action === "review") {
      if (!UUID.test(String(body.shipmentId || ""))) return res.status(400).json({ error: "Invalid shipment reference." });
      if (!["eligible", "not_eligible", "on_hold"].includes(body.eligibility)) return res.status(400).json({ error: "Invalid warehouse eligibility decision." });
      result = await rpc("wms_review_shipment", {
        p_shipment_id: body.shipmentId,
        p_eligibility: body.eligibility,
        p_actor: actor,
        p_reason: String(body.reason || "").slice(0, 500) || null
      });
    } else if (body.action === "pick") {
      if (!UUID.test(String(body.pickTaskId || "")) || !UUID.test(String(body.shipmentLineId || ""))) {
        return res.status(400).json({ error: "Invalid picking reference." });
      }
      const quantity = Number(body.quantityPicked);
      if (!Number.isFinite(quantity) || quantity < 0) return res.status(400).json({ error: "Picked quantity must be zero or greater." });
      result = await rpc("wms_update_pick_line", {
        p_pick_task_id: body.pickTaskId,
        p_shipment_line_id: body.shipmentLineId,
        p_quantity_picked: quantity,
        p_actor: actor
      });
    } else if (body.action === "pack") {
      if (!UUID.test(String(body.warehouseWorkId || ""))) return res.status(400).json({ error: "Invalid warehouse work reference." });
      const numbers = ["weightKg", "lengthCm", "widthCm", "heightCm"].map(k => Number(body[k]));
      if (numbers.some(n => !Number.isFinite(n) || n <= 0)) return res.status(400).json({ error: "Package weight and dimensions must be greater than zero." });
      result = await rpc("wms_pack_shipment", {
        p_warehouse_work_id: body.warehouseWorkId,
        p_package_type: String(body.packageType || "parcel").slice(0, 80),
        p_weight_kg: numbers[0],
        p_length_cm: numbers[1],
        p_width_cm: numbers[2],
        p_height_cm: numbers[3],
        p_actor: actor
      });
    } else if (body.action === "prepare_dispatch") {
      if (!UUID.test(String(body.warehouseWorkId || ""))) return res.status(400).json({ error: "Invalid warehouse work reference." });
      result = await rpc("wms_prepare_dispatch", {
        p_warehouse_work_id: body.warehouseWorkId,
        p_carrier: String(body.carrier || "").slice(0, 120),
        p_tracking_reference: String(body.trackingReference || "").slice(0, 200) || null,
        p_actor: actor
      });
    } else if (body.action === "confirm_dispatch") {
      if (!UUID.test(String(body.dispatchId || ""))) return res.status(400).json({ error: "Invalid dispatch reference." });
      result = await rpc("wms_confirm_dispatch", {
        p_dispatch_id: body.dispatchId,
        p_actor: actor
      });
    } else {
      return res.status(400).json({ error: "Unknown warehouse operation." });
    }

    return res.status(200).json({ success: true, result });
  } catch (error) {
    return res.status(400).json({ error: error.message || "Warehouse operation could not be completed." });
  }
};