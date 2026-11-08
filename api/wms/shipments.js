const { getVerifiedAdmin, originAllowed } = require("../../lib/auth");
const crypto = require("node:crypto");

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
    // Expose only known, actionable warehouse validation messages; keep SQL details private.
    const safeMessages = [
      "Insufficient stock at the assigned location. Record a receipt or stock adjustment before picking.",
      "Picked quantity exceeds required quantity",
      "Picked quantity cannot be negative",
      "Open pick line not found or warehouse work is on hold",
      "Enter and save the ordered quantity for every article line before approving this shipment for picking",
      "One or more ordered articles are not mapped to the warehouse article catalogue",
      "Shipment has no article lines",
      "Shipment has no positive ordered quantities to pick",
      "Ordered quantity is locked after warehouse picking is approved or started. Put the shipment on hold and reconcile it before changing quantities",
      "This source shipment is marked DropShipment. Confirm that your warehouse is responsible for fulfilment before approving it for picking",
      "Warehouse work has already progressed; quantities cannot be re-approved"
    ];
    const databaseMessage = typeof data?.message === "string" ? data.message : "";
    const safeMessage = safeMessages.find(message => databaseMessage.startsWith(message));
    const error = new Error(safeMessage || `WMS database request failed (HTTP ${response.status}).`);
    if (safeMessage) error.status = 400;
    throw error;
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


function buildCarrierDispatchMessage(data) {
  const source = data.raw_payload || {};
  const sourceShipment = source.Shipment || source.shipment;
  if (!sourceShipment || typeof sourceShipment !== "object") throw new Error("The stored source shipment is missing.");
  if (String(sourceShipment.ShipmentKey || "") !== String(data.external_shipment_id || "")) {
    throw new Error("The source ShipmentKey does not match the saved shipment ID. Refresh the shipment before booking.");
  }
  if (String(data.source_status || "") !== "Registered") {
    throw new Error("This shipment is no longer in Registered status. Refresh it before attempting a carrier booking.");
  }

  const work = data.warehouse_work || {};
  if (work.status !== "ready_to_dispatch") throw new Error("Picking and packing must be completed before carrier booking.");
  const packages = Array.isArray(work.packages) ? work.packages : [];
  if (!packages.length || packages.some(p => p.status !== "packed" ||
      [p.weight_kg,p.length_cm,p.width_cm,p.height_cm].some(v => !Number.isFinite(Number(v)) || Number(v) <= 0))) {
    throw new Error("Every package must be packed with actual positive weight and dimensions.");
  }

  const shipmentLines = Array.isArray(data.shipment_lines) ? data.shipment_lines : [];
  const pickTask = work.pick_task || {};
  if (pickTask.status !== "completed") throw new Error("The pick task must be completed before carrier booking.");
  const picked = new Map((Array.isArray(pickTask.lines) ? pickTask.lines : []).map(line => [line.shipment_line_id, Number(line.quantity_picked)]));
  const lineByNumber = new Map();
  for (const line of shipmentLines) {
    const quantity = line.manual_ordered_quantity !== null && line.manual_ordered_quantity !== undefined
      ? Number(line.manual_ordered_quantity)
      : line.requested_quantity !== null && line.requested_quantity !== undefined
        ? Number(line.requested_quantity) : null;
    if (quantity === null || !Number.isFinite(quantity) || quantity < 0) {
      throw new Error("Every article line needs a saved ordered quantity before carrier booking.");
    }
    if (quantity > 0 && !line.article_id) {
      throw new Error("An ordered article is not mapped to the WMS article catalogue.");
    }
    const pickedQuantity = Number(picked.get(line.id) || 0);
    if (pickedQuantity !== quantity) {
      throw new Error("Picked quantities do not match the approved ordered quantities. Reconcile picking before booking.");
    }
    lineByNumber.set(Number(line.line_number), { ...line, effectiveQuantity: quantity, pickedQuantity });
  }

  const sourceDispatchOrders = Array.isArray(source.DispatchOrders) ? source.DispatchOrders : [];
  if (!sourceDispatchOrders.length) throw new Error("The source shipment has no DispatchOrders to send.");
  let globalLineNumber = 0;
  const dispatchOrders = sourceDispatchOrders.map(order => ({
    ...order,
    DispatchOrderStatus: "Dispatched",
    DispatchOrderLines: (Array.isArray(order.DispatchOrderLines) ? order.DispatchOrderLines : []).map(line => {
      globalLineNumber += 1;
      const wmsLine = lineByNumber.get(globalLineNumber);
      if (!wmsLine) throw new Error("The source dispatch line could not be matched to its WMS article line.");
      return {
        ...line,
        RequestedQuantity: wmsLine.effectiveQuantity,
        ConfirmedQuantity: wmsLine.effectiveQuantity,
        DispatchedQuantity: wmsLine.pickedQuantity
      };
    })
  }));

  const sourceGoodsItems = Array.isArray(sourceShipment.GoodsItems) ? sourceShipment.GoodsItems : [];
  const goodsItems = packages.map((pkg, index) => {
    const original = sourceGoodsItems[index] || {};
    const defaultPackageType = sourceGoodsItems[0]?.PackageTypeID || pkg.package_type || "Kolli";
    return {
      ...original,
      GoodsItemKey: original.GoodsItemKey || pkg.id,
      NumberOfPackages: 1,
      WeightInKg: Number(pkg.weight_kg),
      LengthInCm: Number(pkg.length_cm),
      WidthInCm: Number(pkg.width_cm),
      HeightInCm: Number(pkg.height_cm),
      VolumeInM3: Number(pkg.length_cm) * Number(pkg.width_cm) * Number(pkg.height_cm) / 1000000,
      OrderNumber: data.external_order_number || data.external_shipment_id,
      PackageTypeID: original.PackageTypeID || defaultPackageType,
      Parcels: Array.isArray(original.Parcels) ? original.Parcels : []
    };
  });

  const transport = sourceShipment.TransportInformation || {};
  const edi = transport.ForwarderEDI || {};
  if (!transport.ForwarderID || !transport.FreightServiceID) {
    throw new Error("The source shipment is missing its configured forwarder or freight service.");
  }

  const shipment = {
    ...sourceShipment,
    ShipmentKey: data.external_shipment_id,
    TransportInformation: {
      ...transport,
      ForwarderEDI: {
        ...edi,
        ReserveShipment: false,
        TransferShipment: true,
        RequestPickup: false
      }
    },
    GoodsItems: goodsItems,
    PrintSettings: [
      { Document: "ParcelLabel", PrintMode: "Url", NumberOfCopies: "1" }
    ]
  };

  const header = source.MessageHeader || {};
  return {
    ...source,
    MessageHeader: {
      ...header,
      Origin: header.Origin || "Zhister WMS",
      Version: header.Version || "1.0",
      Language: header.Language || "En",
      CreatedDate: { ...(header.CreatedDate || {}), Value: new Date().toISOString() },
      MessageID: crypto.randomUUID()
    },
    Shipment: shipment,
    DispatchOrders: dispatchOrders
  };
}

function extractBookingDetails(data) {
  const details = data?.ShipmentDetails || data?.shipmentDetails || {};
  const parcels = Array.isArray(details.Parcels) ? details.Parcels : [];
  const parcelNumbers = parcels.map(p => p?.ParcelNumber).filter(Boolean).map(String);
  const tracking = parcelNumbers.join(", ") || details.BookingConfirmationNumber || "";
  const print = details.PrintShipmentResponse || {};
  return {
    details,
    trackingReference: String(tracking || ""),
    labelAvailable: Boolean(print.DocumentPDF || print.DocumentUrl),
    labelMode: print.DocumentPDF ? "pdf" : print.DocumentUrl ? "url" : null
  };
}

async function bookCarrierShipment(shipmentId, actor) {
  const data = await rpc("get_wms_shipment_dispatch_data", { p_shipment_id: shipmentId });
  if (!data || !data.id) throw new Error("Shipment not found in the WMS database.");
  const message = buildCarrierDispatchMessage(data);
  const workId = data.warehouse_work?.id;
  if (!workId) throw new Error("Warehouse work was not found for this shipment.");

  const prepared = await rpc("wms_prepare_dispatch", {
    p_warehouse_work_id: workId,
    p_carrier: "Zhipster",
    p_tracking_reference: null,
    p_actor: actor
  });
  const dispatchId = prepared?.dispatch_id;
  if (!dispatchId) throw new Error("Could not create the carrier booking attempt.");

  const apiKey = process.env.ZHIPSTER_API_KEY;
  if (!apiKey) {
    await rpc("wms_record_carrier_response", {
      p_dispatch_id: dispatchId, p_success: false, p_tracking_reference: null,
      p_response: { Error: "Zhipster API key is not configured." }, p_actor: actor
    });
    throw new Error("Zhipster integration is not configured in this Preview environment.");
  }

  try {
    const response = await fetch("https://shipmentapi.zhipster.se/v1/Shipment/ImportShipment", {
      method: "POST",
      headers: { "X-Api-Key": apiKey, "Accept": "application/json", "Content-Type": "application/json" },
      body: JSON.stringify(message),
      signal: AbortSignal.timeout(30000)
    });
    const raw = await response.text();
    let result;
    try { result = raw ? JSON.parse(raw) : {}; }
    catch { result = { ResponseStatus: "Error", ResponseStatusDescription: "Zhipster returned invalid JSON." }; }

    const successful = response.ok && String(result.ResponseStatus || "").toLowerCase() === "success";
    const booking = extractBookingDetails(result);
    await rpc("wms_record_carrier_response", {
      p_dispatch_id: dispatchId,
      p_success: successful,
      p_tracking_reference: booking.trackingReference || null,
      p_response: result,
      p_actor: actor
    });

    if (!successful) {
      const description = String(result.ResponseStatusDescription || result.Message || `Zhipster booking failed (HTTP ${response.status}).`).slice(0, 500);
      throw new Error(description);
    }

    return {
      dispatchId,
      shipmentStatus: booking.details.ShipmentStatus || null,
      trackingReference: booking.trackingReference || null,
      bookingConfirmationNumber: booking.details.BookingConfirmationNumber || null,
      labelAvailable: booking.labelAvailable,
      labelMode: booking.labelMode
    };
  } catch (error) {
    if (!(error && error.message && /Zhipster booking failed|ResponseStatusDescription/.test(error.message))) {
      try {
        await rpc("wms_record_carrier_response", {
          p_dispatch_id: dispatchId,
          p_success: false,
          p_tracking_reference: null,
          p_response: { Error: "The booking request did not complete. Refresh the shipment before retrying in case Zhipster accepted it." },
          p_actor: actor
        });
      } catch { /* Preserve the original upstream failure. */ }
    }
    throw error;
  }
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
      const [shipments, manualQuantities, dispatchStatus] = await Promise.all([
        rpc("list_wms_shipments", {}),
        rpc("list_wms_manual_ordered_quantities", {}),
        rpc("list_wms_dispatch_status", {})
      ]);
      const quantities = new Map((Array.isArray(manualQuantities) ? manualQuantities : [])
        .map((entry) => [entry.shipment_line_id, entry]));
      const dispatches = new Map((Array.isArray(dispatchStatus) ? dispatchStatus : [])
        .map((entry) => [entry.shipment_id, entry.dispatches || []]));
      const enriched = (Array.isArray(shipments) ? shipments : []).map((shipment) => ({
        ...shipment,
        shipment_lines: (shipment.shipment_lines || []).map((line) => ({
          ...line,
          manual_ordered_quantity: quantities.get(line.id)?.manual_ordered_quantity ?? null,
          manual_quantity_updated_at: quantities.get(line.id)?.manual_quantity_updated_at ?? null
        })),
        warehouse_work: {
          ...(shipment.warehouse_work || {}),
          dispatches: dispatches.get(shipment.id) || []
        }
      }));
      return res.status(200).json({ shipments: enriched });
    }

    if (!originAllowed(req)) {
      return res.status(403).json({ error: "Request origin is not allowed." });
    }

    const body = typeof req.body === "string" ? JSON.parse(req.body || "{}") : (req.body || {});
    if (body.action === "preview_import" || body.action === "save_import") {
      const orderNumber = String(body.orderNumber || "").trim();
      if (!/^[A-Za-z0-9_-]{1,80}$/.test(orderNumber)) {
        return res.status(400).json({ error: "Enter a valid Bygghemma order number." });
      }
      const data = await fetchZhipster("orderNumber", orderNumber);
      if (!data) return res.status(200).json({ found: false, sourceShipments: [] });
      const records = collectShipments(data);
      if (!records.length) return res.status(200).json({ found: false, sourceShipments: [] });
      if (records.length > 25) return res.status(413).json({ error: "The lookup returned too many shipments for one import." });

      if (body.action === "preview_import") {
        return res.status(200).json({ found: true, sourceShipments: records });
      }

      const manualQuantities = Array.isArray(body.manualQuantities) ? body.manualQuantities : [];
      const supplied = new Map();
      for (const item of manualQuantities) {
        const shipmentId = String(item?.externalShipmentId || "").trim();
        const lineNumber = Number(item?.lineNumber);
        const quantity = Number(item?.quantity);
        const key = `${shipmentId}:${lineNumber}`;
        if (!shipmentId || !Number.isInteger(lineNumber) || lineNumber < 1 ||
            !Number.isInteger(quantity) || quantity < 0 || quantity > 1000000 || supplied.has(key)) {
          return res.status(400).json({ error: "Every article line needs one valid manual ordered quantity." });
        }
        supplied.set(key, quantity);
      }

      const expected = [];
      for (const record of records) {
        const sourceShipment = record.Shipment || record.shipment || record;
        const externalId = String(sourceShipment.ShipmentKey || sourceShipment.ShipmentNumber || "").trim();
        const dispatchOrders = record.DispatchOrders || sourceShipment.DispatchOrders || [];
        if (!externalId || !Array.isArray(dispatchOrders)) {
          return res.status(422).json({ error: "The source response is missing a shipment key or dispatch order lines." });
        }
        let lineNumber = 0;
        for (const order of dispatchOrders) {
          for (const line of (Array.isArray(order.DispatchOrderLines) ? order.DispatchOrderLines : [])) {
            lineNumber += 1;
            expected.push(`${externalId}:${lineNumber}`);
          }
        }
      }
      if (!expected.length || expected.length !== supplied.size || expected.some(key => !supplied.has(key))) {
        return res.status(400).json({ error: "Enter and verify the ordered quantity for every article line before saving." });
      }

      const imported = [];
      for (const record of records) {
        const saved = await rpc("import_wms_shipment", { p_payload: record });
        const shipmentId = saved?.shipment_id;
        if (!shipmentId) throw new Error("The shipment was imported but its saved WMS ID was not returned.");
        const detail = await rpc("get_wms_shipment_dispatch_data", { p_shipment_id: shipmentId });
        const lines = Array.isArray(detail?.shipment_lines) ? detail.shipment_lines : [];
        for (const line of lines) {
          const key = `${detail.external_shipment_id}:${Number(line.line_number)}`;
          if (!supplied.has(key)) throw new Error("The saved article lines no longer match the preview. Refresh the order before saving.");
          await rpc("wms_set_manual_ordered_quantity", {
            p_shipment_line_id: line.id,
            p_quantity: supplied.get(key),
            p_actor: user.id
          });
        }
        imported.push(saved);
      }
      return res.status(200).json({ found: true, imported: imported.length, shipments: imported });
    }

    if (body.action === "confirm_handover") {
      const dispatchId = String(body.dispatchId || "").trim();
      if (!/^[0-9a-f-]{36}$/i.test(dispatchId)) {
        return res.status(400).json({ error: "A valid confirmed dispatch ID is required." });
      }
      const result = await rpc("wms_confirm_dispatch", {
        p_dispatch_id: dispatchId,
        p_actor: user.id
      });
      return res.status(200).json({ ok: true, result });
    }
    if (body.action === "book") {
      const shipmentId = String(body.shipmentId || "").trim();
      if (!/^[0-9a-f-]{36}$/i.test(shipmentId)) {
        return res.status(400).json({ error: "A valid saved shipment ID is required." });
      }
      const result = await bookCarrierShipment(shipmentId, user.id);
      return res.status(200).json({ ok: true, result });
    }
    if (body.action === "set_quantity") {
      const lineId = String(body.shipmentLineId || "").trim();
      const quantity = Number(body.quantity);
      if (!/^[0-9a-f-]{36}$/i.test(lineId) || !Number.isFinite(quantity) || quantity < 0 || quantity > 1000000) {
        return res.status(400).json({ error: "Enter a valid article line and ordered quantity (0 to 1,000,000)." });
      }
      const result = await rpc("wms_set_manual_ordered_quantity", {
        p_shipment_line_id: lineId,
        p_quantity: quantity,
        p_actor: user.id
      });
      return res.status(200).json({ ok: true, result });
    }
    if (body.action === "review") {
      const shipmentId = String(body.shipmentId || "").trim();
      const eligibility = String(body.eligibility || "");
      if (!/^[0-9a-f-]{36}$/i.test(shipmentId) || !["eligible","not_eligible","on_hold"].includes(eligibility)) {
        return res.status(400).json({ error: "A valid shipment and eligibility decision are required." });
      }
      const result = await rpc("wms_review_shipment", {
        p_shipment_id: shipmentId, p_eligibility: eligibility, p_actor: user.id,
        p_reason: body.confirmDropShipment === true
          ? `confirmed_drop_shipment: ${String(body.reason || "Administrator confirmed warehouse fulfilment.").slice(0, 450)}`
          : String(body.reason || "").slice(0, 500) || null
      });
      return res.status(200).json({ ok: true, result });
    }
    if (body.action === "pick") {
      const pickTaskId = String(body.pickTaskId || "").trim();
      const shipmentLineId = String(body.shipmentLineId || "").trim();
      const quantityPicked = Number(body.quantityPicked);
      if (!/^[0-9a-f-]{36}$/i.test(pickTaskId) ||
          !/^[0-9a-f-]{36}$/i.test(shipmentLineId) ||
          !Number.isFinite(quantityPicked) || quantityPicked < 0 || quantityPicked > 1000000) {
        return res.status(400).json({ error: "A valid pick task, article line and picked quantity are required." });
      }
      const result = await rpc("wms_update_pick_line", {
        p_pick_task_id: pickTaskId,
        p_shipment_line_id: shipmentLineId,
        p_quantity_picked: quantityPicked,
        p_actor: user.id
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
    const status = Number.isInteger(error?.status) ? error.status : /temporarily unavailable|service/i.test(message) ? 503 : 502;
    return res.status(status).json({ error: message });
  }
};
