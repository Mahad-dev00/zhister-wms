/**
 * Read-only proxy for the Zhipster Shipment API.
 *
 * Required Vercel environment variable: ZHIPSTER_API_KEY
 * The credential is never sent to the browser.
 */
const { getVerifiedAdmin } = require("../lib/auth");

module.exports = async function handler(req, res) {
  res.setHeader("Cache-Control", "no-store, max-age=0");
  res.setHeader("Content-Type", "application/json; charset=utf-8");

  if (req.method !== "GET") {
    res.setHeader("Allow", "GET");
    return res.status(405).json({ error: "Method not allowed" });
  }

  let user;
  try { user = await getVerifiedAdmin(req, res, true); }
  catch { return res.status(503).json({ error: "Authentication service is temporarily unavailable." }); }
  if (!user || !user.email_confirmed_at || String(user.email || "").toLowerCase() !== "mahad.warsame.work@gmail.com") {
    return res.status(401).json({ error: "Sign in with the authorised WMS administrator account to access live shipments." });
  }

  const apiKey = process.env.ZHIPSTER_API_KEY;
  if (!apiKey) {
    return res.status(503).json({
      error: "Zhipster integration is not configured. Set ZHIPSTER_API_KEY in the server environment."
    });
  }

  const shipmentId = String(req.query.shipmentId || "").trim();
  const orderNumber = String(req.query.orderNumber || "").trim();

  if ((shipmentId && orderNumber) || (!shipmentId && !orderNumber)) {
    return res.status(400).json({ error: "Provide exactly one of shipmentId or orderNumber." });
  }

  const identifier = shipmentId || orderNumber;
  if (!/^[A-Za-z0-9_-]{1,80}$/.test(identifier)) {
    return res.status(400).json({ error: "The supplied identifier has an invalid format." });
  }

  const endpoint = shipmentId
    ? "https://shipmentapi.zhipster.se/v1/Shipment/GetShipment"
    : "https://shipmentapi.zhipster.se/v1/Shipment/GetShipmentsByOrderNumber";
  const parameter = shipmentId ? "shipmentId" : "orderNumber";
  const url = new URL(endpoint);
  url.searchParams.set(parameter, identifier);

  try {
    const upstream = await fetch(url, {
      method: "GET",
      headers: {
        "X-Api-Key": apiKey,
        "Accept": "application/json"
      },
      signal: AbortSignal.timeout(15000)
    });

    if (upstream.status === 204) {
      return res.status(200).json({ found: false, message: "Zhipster returned no shipment for this identifier." });
    }

    const raw = await upstream.text();
    if (!upstream.ok) {
      // Do not forward upstream response bodies; they may contain infrastructure details.
      const status = upstream.status === 401 || upstream.status === 403 ? 502 : upstream.status;
      return res.status(status).json({
        error: upstream.status === 401 || upstream.status === 403
          ? "Zhipster authentication failed. Check the server-side API key."
          : `Zhipster request failed (HTTP ${upstream.status}).`
      });
    }

    let data;
    try {
      data = raw ? JSON.parse(raw) : null;
    } catch {
      return res.status(502).json({ error: "Zhipster returned a response that was not valid JSON." });
    }

    return res.status(200).json({ found: Boolean(data), data });
  } catch (error) {
    const timedOut = error && (error.name === "TimeoutError" || error.name === "AbortError");
    return res.status(502).json({
      error: timedOut ? "Zhipster request timed out. Try again." : "Could not reach Zhipster. Try again later."
    });
  }
};
