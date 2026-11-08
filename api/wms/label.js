const { getVerifiedAdmin } = require("../../lib/auth");

const ADMIN_EMAIL = "mahad.warsame.work@gmail.com";

async function rpc(name, body = {}) {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error("WMS database integration is not configured.");
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
  if (req.method !== "GET") {
    res.setHeader("Allow", "GET");
    return res.status(405).json({ error: "Method not allowed" });
  }

  try {
    const user = await getVerifiedAdmin(req, res, true);
    if (!user || !user.email_confirmed_at || String(user.email || "").toLowerCase() !== ADMIN_EMAIL) {
      return res.status(401).json({ error: "Sign in with the authorised WMS administrator account." });
    }

    const dispatchId = String(req.query.dispatchId || "").trim();
    if (!/^[0-9a-f-]{36}$/i.test(dispatchId)) {
      return res.status(400).json({ error: "A valid carrier dispatch ID is required." });
    }

    const record = await rpc("get_wms_dispatch_label", { p_dispatch_id: dispatchId });
    const print = record?.print_response || {};
    if (!record || !print || typeof print !== "object") {
      return res.status(404).json({ error: "No confirmed shipping label is stored for this dispatch." });
    }

    let pdf;
    if (typeof print.DocumentPDF === "string" && print.DocumentPDF.trim()) {
      const encoded = print.DocumentPDF.replace(/^data:application\/pdf;base64,/i, "").trim();
      pdf = Buffer.from(encoded, "base64");
    } else if (typeof print.DocumentUrl === "string" && print.DocumentUrl.trim()) {
      const labelUrl = new URL(print.DocumentUrl);
      if (labelUrl.protocol !== "https:" || !(labelUrl.hostname === "zhipster.se" || labelUrl.hostname.endsWith(".zhipster.se"))) {
        return res.status(502).json({ error: "Zhipster returned an unsupported label URL." });
      }
      const headers = { Accept: "application/pdf, application/octet-stream" };
      if (process.env.ZHIPSTER_API_KEY) headers["X-Api-Key"] = process.env.ZHIPSTER_API_KEY;
      const upstream = await fetch(labelUrl, { headers, signal: AbortSignal.timeout(20000) });
      if (!upstream.ok) return res.status(502).json({ error: `Could not retrieve the Zhipster label (HTTP ${upstream.status}).` });
      const type = String(upstream.headers.get("content-type") || "").toLowerCase();
      if (type && !type.includes("pdf") && !type.includes("octet-stream")) {
        return res.status(502).json({ error: "Zhipster did not return a PDF label." });
      }
      pdf = Buffer.from(await upstream.arrayBuffer());
    } else {
      return res.status(404).json({ error: "The carrier booking was confirmed, but Zhipster did not return a PDF or label URL." });
    }

    if (!pdf.length || pdf.subarray(0, 5).toString("ascii") !== "%PDF-") {
      return res.status(502).json({ error: "The stored shipping document is not a valid PDF." });
    }

    res.setHeader("Content-Type", "application/pdf");
    res.setHeader("Content-Length", String(pdf.length));
    res.setHeader("Content-Disposition", `inline; filename="zhister-shipment-${String(record.shipment_id || "label").replace(/[^A-Za-z0-9_-]/g, "")}.pdf"`);
    return res.status(200).end(pdf);
  } catch (error) {
    const message = error && error.message ? error.message : "Could not retrieve the shipping label.";
    return res.status(502).json({ error: message });
  }
};
