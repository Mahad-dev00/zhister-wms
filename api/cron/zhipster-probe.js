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

module.exports = async function handler(req, res) {
  if (req.method !== "GET") return res.status(405).json({ error: "Method not allowed" });
  const key = process.env.ZHIPSTER_API_KEY;
  if (!key) return res.status(500).json({ error: "ZHIPSTER_API_KEY is not configured" });
  const { start, end } = todayWindow();
  const endpoints = String(process.env.ZHIPSTER_SYNC_LIST_ENDPOINTS || "").split(",").map(s => s.trim()).filter(Boolean);
  const candidates = endpoints.length ? endpoints : DEFAULT_ENDPOINTS;
  const results = [];
  for (const endpoint of candidates) {
    const url = new URL(endpoint);
    for (const [k,v] of [
      ["fromDate", start.toISOString()], ["toDate", end.toISOString()],
      ["startDate", start.toISOString()], ["endDate", end.toISOString()],
      ["dateFrom", start.toISOString()], ["dateTo", end.toISOString()],
      ["page", "1"], ["pageSize", "100"], ["limit", "100"]
    ]) url.searchParams.set(k, v);
    try {
      const response = await fetch(url, {
        headers: { "X-Api-Key": key, Accept: "application/json" },
        signal: AbortSignal.timeout(15000)
      });
      const raw = await response.text();
      let data = null;
      try { data = raw ? JSON.parse(raw) : null; } catch {}
      results.push({
        endpoint,
        status: response.status,
        contentType: response.headers.get("content-type"),
        ok: response.ok,
        topLevelKeys: data && typeof data === "object" && !Array.isArray(data) ? Object.keys(data).slice(0,30) : null,
        arrayLength: Array.isArray(data) ? data.length : null
      });
    } catch (error) {
      results.push({ endpoint, error: error.message });
    }
  }
  return res.status(200).json({ windowStart: start.toISOString(), windowEnd: end.toISOString(), results });
};
