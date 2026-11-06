const { getVerifiedAdmin, originAllowed } = require("../../lib/auth");

const ADMIN_EMAIL = "mahad.warsame.work@gmail.com";

function collectShipments(data) {
  if (Array.isArray(data)) return data;
  if (!data || typeof data !== "object") return [];
  if (data.Shipment && typeof data.Shipment === "object") return [data];
  for (const key of ["Shipments", "ShipmentList", "shipments", "shipmentList", "Items", "items"]) {
    if (Array.isArray(data[key])) return data[key].map((item) => item.Shipment ? item : { Shipment: item });
  }
  return data.ShipmentKey || data.ShipmentNumber ? [data] : [];
}

async function requireAdmin(req, res) {
  const user = await getVerifiedAdmin(req, res, true);
  if (!user || !user.email_confirmed_at || String(user.email || "").toLowerCase() !== ADMIN_EMAIL) {
    res.status(401).json({ error: "Sign in with the authorised WMS administrator account." });
    return null;
  }
  return user;
}

function supabaseConfig() {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error("WMS database integration is not configured in this Preview environment.");
  return { url: url.replace(/\/$/, ""), key };
}

async function rpc(name, body) {
  const { url, key } = supabaseConfig();
  const response = await fetch(`${url}/rest/v1/rpc/${name}`, {
    method: "POST",
    headers: {
      apikey: key,
      Authorization: `Bearer ${key}`,
      "Content-Type": "application/json",
      Accept: "application/json"
    },
    body: JSON.stringify(body || {}),
    signal: AbortSignal.timeout(15000)
  });
  const raw = await response.text();
  let data;
  try { data = raw ? JSON.parse(raw) : null; } catch { data = null; }
  if (!response.ok) {
    const safeMessages = [
      "Insufficient stock at the assigned location. Record a receipt or stock adjustment before picking.",
      "This order line has no article master record. Refresh the shipment before picking.",
      "Open pick line not found","Picked quantity exceeds required quantity",
      "DropShipment cannot be approved for warehouse picking",
      "Shipment has no positive requested article quantities",
      "Picking must be completed before packing","Warehouse work is not awaiting packing",
      "A packed package is required before dispatch","Prepared dispatch not found",
      "Package weight and all dimensions must be greater than zero",
      "No picked quantities are available to pack","Shipment not found"
    ];
    const dbMessage = data && typeof data.message === "string" ? data.message : "";
    if (safeMessages.some(message => dbMessage.includes(message))) throw new Error(dbMessage);
    throw new Error(`WMS database request failed (HTTP ${response.status}).`);
  }
  return data;
}

async function fetchZhipster(identifierType, identifier) {
  const apiKey = process.env.ZHIPSTER_API_KEY;
  if (!apiKey) throw new Error("Zhipster integration is not configured in this Preview environment.");
  const endpoint = identifierType === "shipmentId"
    ? "https://shipmentapi.zhipster.se/v1/Shipment/GetShipment"
    : "https://shipmentapi.zhipster.se/v1/Shipment/GetShipmentsByOrderNumber";
  const url = new URL(endpoint);
  url.searchParams.set(identifierType, identifier);
  const response = await fetch(url, {
    method: "GET",
    headers: { "X-Api-Key": apiKey, Accept: "application/json" },
    signal: AbortSignal.timeout(15000)
  });
  if (response.status === 204) return null;
  if (!response.ok) {
    if (response.status === 401 || response.status === 403) {
      throw new Error("Zhipster authentication failed. Check the server-side API key.");
    }
    throw new Error(`Zhipster request failed (HTTP ${response.status}).`);
  }
  const raw = await response.text();
  try { return raw ? JSON.parse(raw) : null; }
  catch { throw new Error("Zhipster returned a response that was not valid JSON."); }
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
      const requestUrl = new URL(req.url, `https://${req.headers.host || "localhost"}`);
      const historyFor = String(requestUrl.searchParams.get("historyFor") || "").trim();
      if (historyFor) {
        if (!/^[0-9a-f-]{36}$/i.test(historyFor)) {
          return res.status(400).json({ error: "A valid shipment reference is required for activity history." });
        }
        const history = await rpc("list_wms_shipment_history", { p_shipment_id: historyFor });
        return res.status(200).json({ history: Array.isArray(history) ? history : [] });
      }
      const shipments = await rpc("list_wms_shipments", {});
      return res.status(200).json({ shipments: Array.isArray(shipments) ? shipments : [] });
    }

    if (!originAllowed(req)) {
      return res.status(403).json({ error: "Request origin is not allowed." });
    }

    const body = typeof req.body === "string" ? JSON.parse(req.body || "{}") : (req.body || {});
    if (body.action === "review") {
      const shipmentId = String(body.shipmentId || "").trim();
      const eligibility = String(body.eligibility || "");
      if (!/^[0-9a-f-]{36}$/i.test(shipmentId) || !["eligible","not_eligible","on_hold"].includes(eligibility)) {
        return res.status(400).json({ error: "A valid shipment and eligibility decision are required." });
      }
      const result = await rpc("wms_review_shipment", {
        p_shipment_id: shipmentId, p_eligibility: eligibility, p_actor: user.id,
        p_reason: String(body.reason || "").slice(0, 500) || null
      });
      return res.status(200).json({ ok: true, result });
    }
    if (body.action === "pick") {
      const pickTaskId = String(body.pickTaskId || "").trim();
      const shipmentLineId = String(body.shipmentLineId || "").trim();
      const quantity = Number(body.quantityPicked);
      if (!/^[0-9a-f-]{36}$/i.test(pickTaskId) || !/^[0-9a-f-]{36}$/i.test(shipmentLineId) || !Number.isFinite(quantity) || quantity < 0) {
        return res.status(400).json({ error: "Valid pick task, article line and picked quantity are required." });
      }
      const result = await rpc("wms_update_pick_line", {
        p_pick_task_id: pickTaskId, p_shipment_line_id: shipmentLineId,
        p_quantity_picked: quantity, p_actor: user.id
      });
      return res.status(200).json({ ok: true, result });
    }
    if (body.action === "dispatch_prepare") {
      const workId = String(body.warehouseWorkId || "").trim();
      const carrier = String(body.carrier || "").trim();
      const trackingReference = String(body.trackingReference || "").trim();
      if (!/^[0-9a-f-]{36}$/i.test(workId) || !carrier || carrier.length > 120 || trackingReference.length > 160) {
        return res.status(400).json({ error: "A valid packed shipment, carrier and optional tracking reference are required." });
      }
      const result = await rpc("wms_prepare_dispatch", {
        p_warehouse_work_id: workId, p_carrier: carrier,
        p_tracking_reference: trackingReference || null, p_actor: user.id
      });
      return res.status(200).json({ ok: true, result });
    }
    if (body.action === "dispatch_confirm") {
      const dispatchId = String(body.dispatchId || "").trim();
      if (!/^[0-9a-f-]{36}$/i.test(dispatchId)) {
        return res.status(400).json({ error: "A valid prepared dispatch reference is required." });
      }
      const result = await rpc("wms_confirm_dispatch", {
        p_dispatch_id: dispatchId, p_actor: user.id
      });
      return res.status(200).json({ ok: true, result });
    }
    if (body.action === "pack") {
      const workId = String(body.warehouseWorkId || "").trim();
      const values = [body.weightKg, body.lengthCm, body.widthCm, body.heightCm].map(Number);
      if (!/^[0-9a-f-]{36}$/i.test(workId) || values.some(v => !Number.isFinite(v) || v <= 0)) {
        return res.status(400).json({ error: "Warehouse work and positive package weight and dimensions are required." });
      }
      const result = await rpc("wms_pack_shipment", {
        p_warehouse_work_id: workId, p_package_type: String(body.packageType || "parcel").slice(0, 80),
        p_weight_kg: values[0], p_length_cm: values[1], p_width_cm: values[2], p_height_cm: values[3],
        p_actor: user.id
      });
      return res.status(200).json({ ok: true, result });
    }

    const shipmentId = String(body.shipmentId || "").trim();
    const orderNumber = String(body.orderNumber || "").trim();
    if ((shipmentId && orderNumber) || (!shipmentId && !orderNumber)) {
      return res.status(400).json({ error: "Provide exactly one of shipmentId or orderNumber." });
    }

    const identifier = shipmentId || orderNumber;
    if (!/^[A-Za-z0-9_-]{1,80}$/.test(identifier)) {
      return res.status(400).json({ error: "The supplied identifier has an invalid format." });
    }

    const data = await fetchZhipster(shipmentId ? "shipmentId" : "orderNumber", identifier);
    if (!data) return res.status(200).json({ found: false, imported: 0, message: "Zhipster returned no shipment." });

    const records = collectShipments(data);
    if (!records.length) {
      return res.status(200).json({ found: false, imported: 0, message: "Zhipster returned no identifiable shipment record." });
    }
    if (records.length > 25) {
      return res.status(413).json({ error: "The lookup returned too many shipments for one import. Search a single order number." });
    }

    const imported = [];
    for (const record of records) {
      imported.push(await rpc("import_wms_shipment", { p_payload: record }));
    }
    return res.status(200).json({ found: true, imported: imported.length, shipments: imported, sourceShipments: records });
  } catch (error) {
    const message = error && error.message ? error.message : "Could not complete the WMS shipment request.";
    const status = /temporarily unavailable|service/i.test(message) ? 503 : 502;
    return res.status(status).json({ error: message });
  }
};
