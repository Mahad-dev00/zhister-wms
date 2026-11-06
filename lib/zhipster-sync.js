function todayWindow() {
  const now = new Date();
  const timeZone = "Europe/Stockholm";
  const formatter = new Intl.DateTimeFormat("en-US", {
    timeZone, year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", second: "2-digit", hourCycle: "h23"
  });
  function localClockAsUtc(date) {
    const parts = Object.fromEntries(formatter.formatToParts(date).map(part => [part.type, part.value]));
    return Date.UTC(Number(parts.year), Number(parts.month)-1, Number(parts.day),
      Number(parts.hour), Number(parts.minute), Number(parts.second));
  }
  const parts = Object.fromEntries(formatter.formatToParts(now).map(part => [part.type, part.value]));
  const midnight = Date.UTC(Number(parts.year), Number(parts.month)-1, Number(parts.day));
  let startMs = midnight;
  for (let i=0;i<4;i++) startMs = midnight - (localClockAsUtc(new Date(startMs))-startMs);
  return { start: new Date(startMs), end: now };
}

function apiKey() {
  const key = process.env.ZHIPSTER_API_KEY;
  if (!key) throw new Error("ZHIPSTER_API_KEY is not configured.");
  return key;
}

function shipmentEndpoint() {
  return String(process.env.ZHIPSTER_GET_SHIPMENT_ENDPOINT ||
    "https://shipmentapi.zhipster.se/v1/Shipment/GetShipment").trim();
}
function shipmentsByOrderEndpoint() {
  return String(process.env.ZHIPSTER_GET_SHIPMENTS_BY_ORDER_ENDPOINT ||
    "https://shipmentapi.zhipster.se/v1/Shipment/GetShipmentsByOrderNumber").trim();
}
function trackByOrderEndpoint() {
  return String(process.env.ZHIPSTER_TRACK_BY_ORDER_ENDPOINT || "").trim();
}

function collectShipments(data) {
  if (Array.isArray(data)) return data;
  if (!data || typeof data !== "object") return [];
  for (const key of ["Shipments","ShipmentList","shipments","shipmentList","Items","items","Data","data"]) {
    if (Array.isArray(data[key])) return data[key].map(item => item && item.Shipment ? item : {Shipment:item});
  }
  if (data.Shipment && typeof data.Shipment === "object") return [data];
  if (data.ShipmentKey || data.ShipmentNumber || data.ShipmentID) return [data];
  return [];
}
function shipmentObject(record) {
  return record && record.Shipment && typeof record.Shipment === "object" ? record.Shipment : record;
}
function shipmentIdentifier(record) {
  const s = shipmentObject(record) || {};
  return String(s.ShipmentKey || s.ShipmentID || s.ShipmentNumber || "").trim();
}

async function requestJson(url, init = {}) {
  const response = await fetch(url, {
    ...init,
    headers: {"X-Api-Key":apiKey(),Accept:"application/json",...(init.headers||{})},
    signal: AbortSignal.timeout(20000)
  });
  const raw = await response.text();
  let data = null;
  try { data = raw ? JSON.parse(raw) : null; } catch { throw new Error("Zhipster API returned invalid JSON."); }
  if (!response.ok) {
    if (response.status===401 || response.status===403) throw new Error("Zhipster authentication failed during order-index sync.");
    if (response.status===429) throw new Error("Zhipster rate limit reached; the next scheduled sync will retry.");
    throw new Error("Zhipster API request failed (HTTP "+response.status+").");
  }
  return data;
}

async function supabaseRpc(name, body) {
  const url=String(process.env.SUPABASE_URL||"").replace(/\/$/,"");
  const key=process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error("Supabase server-side integration is not configured.");
  const response=await fetch(url+"/rest/v1/rpc/"+name,{
    method:"POST",
    headers:{apikey:key,Authorization:"Bearer "+key,"Content-Type":"application/json",Accept:"application/json"},
    body:JSON.stringify(body||{}),signal:AbortSignal.timeout(15000)
  });
  const raw=await response.text();
  let data=null;
  try { data=raw?JSON.parse(raw):null; } catch {}
  if (!response.ok) throw new Error("WMS database request failed (HTTP "+response.status+").");
  return data;
}

async function listIndexedOrders(start,end) {
  const result=await supabaseRpc("list_wms_order_index",{p_from:start.toISOString(),p_to:end.toISOString()});
  return Array.isArray(result)?result:[];
}
async function getShipmentsByOrderNumber(orderNumber) {
  const url=new URL(shipmentsByOrderEndpoint());
  url.searchParams.set("orderNumber",orderNumber);
  return collectShipments(await requestJson(url.toString()));
}
async function getFullShipment(identifier) {
  const url=new URL(shipmentEndpoint());
  url.searchParams.set("shipmentId",identifier);
  return requestJson(url.toString());
}
async function importShipment(record) {
  return supabaseRpc("import_wms_shipment",{p_payload:record});
}
async function recordTracking(orderNumber,payload) {
  return supabaseRpc("record_wms_order_tracking",{p_order_number:orderNumber,p_payload:payload});
}
async function writeRun(run) {
  try { await supabaseRpc("record_wms_sync_run",{p_run:run}); } catch {}
}

async function runSync() {
  const {start,end}=todayWindow();
  const started=new Date();
  const indexedOrders=await listIndexedOrders(start,end);
  const errors=[];
  let imported=0, refreshed=0, tracked=0;

  for (const order of indexedOrders) {
    const orderNumber=String(order.order_number||"").trim();
    if (!orderNumber) continue;
    try {
      const summaries=await getShipmentsByOrderNumber(orderNumber);
      const seen=new Set();
      for (const summary of summaries) {
        const identifier=shipmentIdentifier(summary);
        if (!identifier || seen.has(identifier)) continue;
        seen.add(identifier);
        const full=await getFullShipment(identifier);
        await importShipment(full && full.Shipment ? full : {Shipment:full});
        imported++;
        refreshed++;
      }
      if (trackByOrderEndpoint()) {
        const url=new URL(trackByOrderEndpoint());
        url.searchParams.set("orderNumber",orderNumber);
        const tracking=await requestJson(url.toString());
        await recordTracking(orderNumber,tracking);
        tracked++;
      } else {
        // GetShipment refreshes every known shipment when the dedicated tracking
        // operation is not configured; no unverified Tracking URL is guessed.
        await supabaseRpc("touch_wms_order_index",{p_order_number:orderNumber});
      }
    } catch (error) {
      errors.push({orderNumber,message:error.message});
    }
  }

  const status=errors.length?(imported||refreshed?"partial":"failed"):"success";
  const result={
    status,windowStart:start.toISOString(),windowEnd:end.toISOString(),
    source:"zhister_order_index",indexedOrders:indexedOrders.length,
    imported,refreshed,tracked,failed:errors.length,errors
  };
  await writeRun({
    status,started_at:started.toISOString(),finished_at:new Date().toISOString(),
    window_start:start.toISOString(),window_end:end.toISOString(),
    discovered:indexedOrders.length,imported,failed:errors.length,
    message:"Zhipster order-index sync",errors
  });
  return result;
}

module.exports={runSync,todayWindow};
