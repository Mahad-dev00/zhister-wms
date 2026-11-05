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
    return false;
  }
  return true;
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
    // Keep database internals and privileged response details out of the client response.
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
    if (!(await requireAdmin(req, res))) return;

    if (req.method === "GET") {
      const shipments = await rpc("list_wms_shipments", {});
      return res.status(200).json({ shipments: Array.isArray(shipments) ? shipments : [] });
    }

    if (!originAllowed(req)) {
      return res.status(403).json({ error: "Request origin is not allowed." });
    }

    const body = typeof req.body === "string" ? JSON.parse(req.body || "{}") : (req.body || {});
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
    return res.status(200).json({ found: true, imported: imported.length, shipments: imported });
  } catch (error) {
    const message = error && error.message ? error.message : "Could not complete the WMS shipment request.";
    const status = /temporarily unavailable|service/i.test(message) ? 503 : 502;
    return res.status(status).json({ error: message });
  }
};
