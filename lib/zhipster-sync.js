function todayWindow() {
  const now = new Date();
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: "Europe/Stockholm",
    year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", second: "2-digit",
    hourCycle: "h23"
  }).formatToParts(now).reduce((acc, part) => {
    if (part.type !== "literal") acc[part.type] = Number(part.value);
    return acc;
  }, {});
  const localMidnightAsUtc = Date.UTC(parts.year, parts.month - 1, parts.day);
  let startMs = localMidnightAsUtc;
  // Resolve the Stockholm UTC offset at local midnight (including DST).
  for (let i = 0; i < 3; i++) {
    const atCandidate = new Date(startMs);
    const atParts = new Intl.DateTimeFormat("en-GB", {
      timeZone: "Europe/Stockholm",
      year: "numeric", month: "2-digit", day: "2-digit",
      hour: "2-digit", minute: "2-digit", second: "2-digit",
      hourCycle: "h23"
    }).formatToParts(atCandidate).reduce((acc, part) => {
      if (part.type !== "literal") acc[part.type] = Number(part.value);
      return acc;
    }, {});
    const representedAsUtc = Date.UTC(atParts.year, atParts.month - 1, atParts.day, atParts.hour, atParts.minute, atParts.second);
    const delta = localMidnightAsUtc - representedAsUtc;
    if (!delta) break;
    startMs += delta;
  }
  return { start: new Date(startMs), end: now };
}

function apiKey() {
  const key = process.env.ZHIPSTER_API_KEY;
  if (!key) throw new Error("ZHIPSTER_API_KEY is not configured.");
  return key;
}

function listEndpoints() {
  const configured = String(
    process.env.ZHIPSTER_SYNC_LIST_ENDPOINT ||
    process.env.ZHIPSTER_SYNC_LIST_ENDPOINTS ||
    ""
  ).trim();
  const endpoints = [...new Set(configured.split(",").flatMap(value => value.split(";")).map(value => value.trim()).filter(Boolean))];
  if (!endpoints.length) {
    throw new Error("ZHIPSTER_SYNC_LIST_ENDPOINTS is not configured. Configure at least one supported Zhipster shipment-list endpoint.");
  }
  for (const endpoint of endpoints) {
    let parsed;
    try { parsed = new URL(endpoint); } catch { throw new Error("A configured Zhipster list endpoint is not a valid URL."); }
    if (parsed.protocol !== "https:" || parsed.hostname !== "shipmentapi.zhipster.se") {
      throw new Error("Configured Zhipster list endpoints must use the official HTTPS shipment API host.");
    }
  }
  return endpoints;
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
  return d ? d >= start && d <= end : false;
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
  const startIso = start.toISOString();
  const endIso = end.toISOString();
  const candidates = listEndpoints();
  const failures = [];
  for (const endpoint of candidates) {
    const url = new URL(endpoint);
    for (const [k, v] of [
      ["fromDate", startIso], ["toDate", endIso],
      ["startDate", startIso], ["endDate", endIso],
      ["dateFrom", startIso], ["dateTo", endIso],
      ["page", "1"], ["pageSize", "100"], ["limit", "100"]
    ]) url.searchParams.set(k, v);
    const response = await fetch(url.toString(), {
      method: "GET",
      headers: { "X-Api-Key": apiKey(), Accept: "application/json" },
      signal: AbortSignal.timeout(20000)
    });
    const raw = await response.text();
    if ([404, 405, 501].includes(response.status)) {
      failures.push(`${new URL(endpoint).pathname}: HTTP ${response.status}`);
      continue;
    }
    if (!response.ok) {
      if (response.status === 401 || response.status === 403) throw new Error("Zhipster authentication failed while discovering new shipments.");
      if (response.status === 429) throw new Error("Zhipster rate limit reached. Please try the import again later.");
      throw new Error(`Zhipster shipment discovery failed (HTTP ${response.status}) at ${new URL(endpoint).pathname}.`);
    }
    let data;
    try { data = raw ? JSON.parse(raw) : null; }
    catch { throw new Error(`Zhipster returned invalid JSON from ${new URL(endpoint).pathname}.`); }
    return { endpoint, records: collectShipments(data) };
  }
  throw new Error(`None of the configured Zhipster shipment-list routes is supported. ${failures.join("; ")}`);
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

async function listStoredShipments() {
  const url = String(process.env.SUPABASE_URL || "").replace(/\/$/, "");
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error("Supabase server-side integration is not configured.");
  const response = await fetch(`${url}/rest/v1/rpc/list_wms_shipments`, {
    method: "POST",
    headers: {
      apikey: key,
      Authorization: `Bearer ${key}`,
      "Content-Type": "application/json",
      Accept: "application/json"
    },
    body: "{}",
    signal: AbortSignal.timeout(15000)
  });
  if (!response.ok) throw new Error(`Could not load existing WMS shipments for refresh (HTTP ${response.status}).`);
  const data = await response.json();
  return Array.isArray(data) ? data : [];
}

async function runSync() {
  const { start, end } = todayWindow();
  const started = new Date();
  const errors = [];
  let refreshed = 0;
  let imported = 0;
  let skippedOutsideWindow = 0;
  let discovered = 0;
  let discoveryEndpoint = null;
  let discoveryError = null;

  // First refresh every shipment already known to WMS. This is deliberately
  // independent of the daily discovery window so older shipments can receive
  // status changes and changed article lines are reconciled by the database.
  const stored = await listStoredShipments();
  const knownIds = new Set();
  for (const item of stored) {
    const identifier = String(item.external_shipment_id || "").trim();
    if (!identifier || knownIds.has(identifier)) continue;
    knownIds.add(identifier);
    try {
      const fullShipment = await getFullShipment(identifier);
      if (!fullShipment) {
        errors.push({ identifier, stage: "refresh", message: "Zhipster returned no shipment for a previously stored shipment key." });
        continue;
      }
      await importShipment(fullShipment);
      refreshed++;
    } catch (error) {
      errors.push({ identifier, stage: "refresh", message: error.message });
    }
  }

  // New-order discovery is separate: GetShipment requires a known shipment
  // key and cannot discover unknown keys. The configured list route must be
  // a real, Zhipster-supported endpoint; never infer one from GetShipment.
  try {
    const discovery = await discoverShipments(start, end);
    discoveryEndpoint = discovery.endpoint;
    const seen = new Set(knownIds);
    const unique = discovery.records.filter(record => {
      const key = shipmentIdentifier(record);
      if (!key || seen.has(key)) return false;
      seen.add(key);
      return true;
    });
    discovered = unique.length;

    for (const record of unique) {
      try {
        const identifier = shipmentIdentifier(record);
        const fullShipment = await getFullShipment(identifier);
        if (!fullShipment || !inWindow(fullShipment, start, end)) {
          skippedOutsideWindow++;
          continue;
        }
        await importShipment(fullShipment);
        imported++;
      } catch (error) {
        errors.push({ identifier: shipmentIdentifier(record), stage: "discovery_import", message: error.message });
      }
    }
  } catch (error) {
    discoveryError = error.message;
    errors.push({ stage: "discovery", message: discoveryError });
  }

  const status = errors.length
    ? (refreshed || imported ? "partial" : "failed")
    : "success";
  await writeRun({
    status,
    started_at: started.toISOString(),
    finished_at: new Date().toISOString(),
    window_start: start.toISOString(),
    window_end: end.toISOString(),
    discovered,
    imported: imported + refreshed,
    skipped: skippedOutsideWindow,
    failed: errors.length,
    message: discoveryEndpoint || (discoveryError ? `Discovery unavailable: ${discoveryError}` : "Existing shipment refresh"),
    errors
  });

  return {
    status,
    windowStart: start.toISOString(),
    windowEnd: end.toISOString(),
    existingShipments: stored.length,
    refreshed,
    discovery: discoveryError ? "unavailable" : "completed",
    discoveryEndpoint,
    discovered,
    newlyImported: imported,
    skipped: skippedOutsideWindow,
    failed: errors.length,
    errors
  };
}

module.exports = { runSync };
