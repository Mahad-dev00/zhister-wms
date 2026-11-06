const DEFAULT_ENDPOINTS = [
  "https://shipmentapi.zhipster.se/v1/Shipment/GetShipmentsByDateRange",
  "https://shipmentapi.zhipster.se/v1/Shipment/GetShipments",
  "https://shipmentapi.zhipster.se/v1/Shipment/GetShipmentList"
];

function todayWindow() {
  const now = new Date();
  const start = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
  return { start, end: now };
}

function apiKey() {
  const key = process.env.ZHIPSTER_API_KEY;
  if (!key) throw new Error("ZHIPSTER_API_KEY is not configured.");
  return key;
}

function endpoints() {
  const configured = String(process.env.ZHIPSTER_SYNC_LIST_ENDPOINTS || "")
    .split(",").map(s => s.trim()).filter(Boolean);
  return configured.length ? configured : DEFAULT_ENDPOINTS;
}

function collectShipments(data) {
  if (Array.isArray(data)) return data;
  if (!data || typeof data !== "object") return [];
  const direct = ["Shipments","ShipmentList","shipments","shipmentList","Items","items","Data","data"];
  for (const key of direct) {
    if (Array.isArray(data[key])) {
      return data[key].map(item => item && item.Shipment ? item : { Shipment: item });
    }
  }
  if (data.Shipment && typeof data.Shipment === "object") return [data];
  if (data.ShipmentKey || data.ShipmentNumber) return [data];
  return [];
}

function shipmentObject(record) {
  return record && record.Shipment && typeof record.Shipment === "object"
    ? record.Shipment
    : record;
}

function shipmentDate(record) {
  const s = shipmentObject(record) || {};
  const candidates = [
    s.ShipmentStatusDate && s.ShipmentStatusDate.Value,
    s.CreatedDate && s.CreatedDate.Value,
    s.CreatedDate,
    s.UpdatedDate && s.UpdatedDate.Value,
    s.UpdatedDate
  ];
  for (const value of candidates) {
    const d = value ? new Date(value) : null;
    if (d && !Number.isNaN(d.getTime())) return d;
  }
  return null;
}

function inWindow(record, start, end) {
  const d = shipmentDate(record);
  return d ? d >= start && d <= end : true;
}

async function requestEndpoint(endpoint, start, end) {
  const url = new URL(endpoint);
  const startIso = start.toISOString();
  const endIso = end.toISOString();
  for (const [k,v] of [
    ["fromDate", startIso], ["toDate", endIso],
    ["startDate", startIso], ["endDate", endIso],
    ["dateFrom", startIso], ["dateTo", endIso],
    ["page", "1"], ["pageSize", "100"], ["limit", "100"]
  ]) url.searchParams.set(k, v);

  const response = await fetch(url, {
    headers: { "X-Api-Key": apiKey(), Accept: "application/json" },
    signal: AbortSignal.timeout(20000)
  });
  if (response.status === 404 || response.status === 405) return { unsupported: true };
  const raw = await response.text();
  let data = null;
  try { data = raw ? JSON.parse(raw) : null; } catch { throw new Error("Zhipster list endpoint returned invalid JSON."); }
  if (!response.ok) {
    if (response.status === 401 || response.status === 403) throw new Error("Zhipster authentication failed while running automatic sync.");
    if (response.status === 429) throw new Error("Zhipster rate limit reached. Automatic sync will retry on the next run.");
    throw new Error(`Zhipster list request failed (HTTP ${response.status}).`);
  }
  return { data };
}

async function importShipment(record) {
  const url = String(process.env.SUPABASE_URL || "").replace(/\/$/, "");
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error("Supabase server-side integration is not configured.");
  const response = await fetch(`${url}/rest/v1/rpc/import_wms_shipment`, {
    method: "POST",
    headers: {
      apikey: key,
      Authorization: `Bearer ${key}`,
      "Content-Type": "application/json",
      Accept: "application/json"
    },
    body: JSON.stringify({ p_payload: record }),
    signal: AbortSignal.timeout(15000)
  });
  if (!response.ok) throw new Error(`WMS import failed (HTTP ${response.status}).`);
  return response.json();
}

async function writeRun(run) {
  const url = String(process.env.SUPABASE_URL || "").replace(/\/$/, "");
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) return;
  await fetch(`${url}/rest/v1/sync_runs`, {
    method: "POST",
    headers: {
      apikey: key,
      Authorization: `Bearer ${key}`,
      "Content-Type": "application/json",
      Prefer: "return=minimal"
    },
    body: JSON.stringify(run)
  }).catch(() => {});
}

async function runSync() {
  const { start, end } = todayWindow();
  const started = new Date();
  let records = [];
  let endpointUsed = null;
  let lastUnsupported = true;

  for (const endpoint of endpoints()) {
    const result = await requestEndpoint(endpoint, start, end);
    if (result.unsupported) continue;
    lastUnsupported = false;
    endpointUsed = endpoint;
    records = collectShipments(result.data).filter(r => inWindow(r, start, end));
    break;
  }

  if (lastUnsupported) {
    throw new Error("No configured Zhipster shipment-list endpoint is available. Set ZHIPSTER_SYNC_LIST_ENDPOINTS to the endpoint exposed by your Zhipster API.");
  }

  const seen = new Set();
  const unique = records.filter(record => {
    const s = shipmentObject(record) || {};
    const key = String(s.ShipmentKey || s.ShipmentID || s.ShipmentNumber || "").trim();
    if (!key || seen.has(key)) return false;
    seen.add(key);
    return true;
  });

  const errors = [];
  let imported = 0;
  for (const record of unique) {
    try {
      await importShipment(record);
      imported++;
    } catch (error) {
      errors.push({ message: error.message });
    }
  }

  const status = errors.length ? (imported ? "partial" : "failed") : "success";
  await writeRun({
    status,
    started_at: started.toISOString(),
    finished_at: new Date().toISOString(),
    window_start: start.toISOString(),
    window_end: end.toISOString(),
    discovered: unique.length,
    imported,
    failed: errors.length,
    message: endpointUsed,
    errors
  });

  return {
    status,
    windowStart: start.toISOString(),
    windowEnd: end.toISOString(),
    endpoint: endpointUsed,
    discovered: unique.length,
    imported,
    failed: errors.length,
    errors
  };
}

module.exports = { runSync };
