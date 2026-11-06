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

function listEndpoint() {
  const endpoint = String(process.env.ZHIPSTER_SYNC_LIST_ENDPOINT || "").trim();
  if (!endpoint) {
    throw new Error("ZHIPSTER_SYNC_LIST_ENDPOINT is not configured. Configure the exact Zhipster shipment-list/search endpoint before enabling automatic discovery.");
  }
  return endpoint;
}

function shipmentEndpoint() {
  return String(
    process.env.ZHIPSTER_GET_SHIPMENT_ENDPOINT ||
      "https://shipmentapi.zhipster.se/v1/Shipment/GetShipment"
  ).trim();
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
  if (data.ShipmentKey || data.ShipmentNumber || data.ShipmentID) return [data];
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

function shipmentIdentifier(record) {
  const s = shipmentObject(record) || {};
  return String(
    s.ShipmentKey || s.ShipmentID || s.ShipmentNumber ||
    record.ShipmentKey || record.ShipmentID || record.ShipmentNumber || ""
  ).trim();
}

async function requestJson(url, init = {}) {
  const response = await fetch(url, {
    ...init,
    headers: {
      "X-Api-Key": apiKey(),
      Accept: "application/json",
      ...(init.headers || {})
    },
    signal: AbortSignal.timeout(20000)
  });
  const raw = await response.text();
  let data = null;
  try { data = raw ? JSON.parse(raw) : null; } catch {
    throw new Error("Zhipster API returned invalid JSON.");
  }
  if (!response.ok) {
    if (response.status === 401 || response.status === 403) {
      throw new Error("Zhipster authentication failed while running automatic sync.");
    }
    if (response.status === 429) {
      throw new Error("Zhipster rate limit reached. Automatic sync will retry on the next run.");
    }
    throw new Error(`Zhipster API request failed (HTTP ${response.status}).`);
  }
  return data;
}

async function discoverShipments(start, end) {
  const url = new URL(listEndpoint());
  const startIso = start.toISOString();
  const endIso = end.toISOString();

  // The endpoint is supplied by the Zhipster API contract. These aliases keep
  // the adapter tolerant of common date parameter naming without guessing the path.
  for (const [k, v] of [
    ["fromDate", startIso], ["toDate", endIso],
    ["startDate", startIso], ["endDate", endIso],
    ["dateFrom", startIso], ["dateTo", endIso],
    ["page", "1"], ["pageSize", "100"], ["limit", "100"]
  ]) url.searchParams.set(k, v);

  return collectShipments(await requestJson(url.toString()));
}

async function getFullShipment(identifier) {
  const url = new URL(shipmentEndpoint());
  url.searchParams.set("shipmentId", identifier);
  const data = await requestJson(url.toString());
  return data && data.Shipment ? data : data;
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
  await fetch(`${url}/rest/v1/rpc/record_wms_sync_run`, {
    method: "POST",
    headers: {
      apikey: key,
      Authorization: `Bearer ${key}`,
      "Content-Type": "application/json",
      Accept: "application/json"
    },
    body: JSON.stringify({ p_run: run }),
    signal: AbortSignal.timeout(10000)
  }).catch(() => {});
}

async function runSync() {
  const { start, end } = todayWindow();
  const started = new Date();

  const discoveredRecords = (await discoverShipments(start, end))
    .filter(r => inWindow(r, start, end));

  const seen = new Set();
  const unique = discoveredRecords.filter(record => {
    const key = shipmentIdentifier(record);
    if (!key || seen.has(key)) return false;
    seen.add(key);
    return true;
  });

  const errors = [];
  let imported = 0;

  for (const record of unique) {
    try {
      const identifier = shipmentIdentifier(record);
      // List/search responses may be summaries. Always retrieve the canonical
      // shipment before importing so WMS receives the full Zhipster payload.
      const fullShipment = await getFullShipment(identifier);
      await importShipment(fullShipment);
      imported++;
    } catch (error) {
      errors.push({
        identifier: shipmentIdentifier(record),
        message: error.message
      });
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
    message: listEndpoint(),
    errors
  });

  return {
    status,
    windowStart: start.toISOString(),
    windowEnd: end.toISOString(),
    endpoint: listEndpoint(),
    discovered: unique.length,
    imported,
    failed: errors.length,
    errors
  };
}

module.exports = { runSync };
