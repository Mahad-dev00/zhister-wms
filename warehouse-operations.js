(function () {
  const esc = safeText;
  const statusLabel = function (s) {
    return ({
      needs_review: "Needs review", eligible: "Eligible", not_eligible: "Not eligible", on_hold: "On hold",
      ready_to_pick: "Ready to pick", picking: "Picking", packing: "Packing",
      ready_to_dispatch: "Ready to dispatch", dispatched: "Handed to carrier", on_hold_work: "On hold"
    })[s] || String(s || "Not started").replace(/_/g, " ");
  };
  const getWork = function (s) { return s.warehouse_work || {}; };
  const getTask = function (s) { return getWork(s).pick_task || {}; };
  const lines = function (s) { return Array.isArray(s.shipment_lines) ? s.shipment_lines : []; };
  const linePick = function (s, lineId) {
    const task = getTask(s);
    return (task.lines || []).find(function (x) { return x.shipment_line_id === lineId; });
  };
  const currentShipment = function (id) { return wmsShipments.find(function (s) { return s.id === id; }); };

  async function operate(payload, successMessage) {
    const response = await fetch("/api/wms/operations", {
      method: "POST",
      headers: { "Content-Type": "application/json", Accept: "application/json" },
      body: JSON.stringify(payload),
      cache: "no-store"
    });
    const body = await response.json();
    if (!response.ok) throw new Error(body.error || "Warehouse operation failed.");
    await loadWmsShipments();
    if (successMessage) toast(successMessage);
    return body.result;
  }

  const originalLoad = loadWmsShipments;
  loadWmsShipments = async function () {
    await originalLoad();
    renderPicking();
    renderPacking();
    renderShipping();
  };

  showWmsShipment = function (id) {
    const s = currentShipment(id);
    if (!s) return;
    const work = getWork(s);
    const model = String(s.distribution_model || "").toLowerCase().replace(/[^a-z]/g, "");
    const isDrop = model === "dropship" || model === "dropshipment";
    const task = getTask(s);
    const dispatches = work.dispatches || [];
    const newestDispatch = dispatches[0];
    const canReview = !["eligible", "not_eligible"].includes(s.eligibility) && !["picking", "packing", "ready_to_dispatch", "dispatched"].includes(work.status);
    $("#modalContent").innerHTML =
      '<div class="eyebrow">ZHIPSTER SHIPMENT / ' + esc(s.external_shipment_id) + '</div>' +
      '<h2>' + esc(s.external_shipment_number || s.external_order_number || "Shipment") + '</h2>' +
      '<p class="muted">Order reference: ' + esc(s.external_order_number || "Not supplied") + '</p>' +
      '<div class="detail-grid">' +
      '<div class="detail-box"><small>ZHIPSTER STATUS</small><strong>' + esc(s.source_status || "Unknown") + '</strong></div>' +
      '<div class="detail-box"><small>DISTRIBUTION MODEL</small><strong>' + esc(s.distribution_model || "Not supplied") + '</strong></div>' +
      '<div class="detail-box"><small>WAREHOUSE ELIGIBILITY</small><strong>' + esc(statusLabel(s.eligibility)) + '</strong></div>' +
      '<div class="detail-box"><small>WAREHOUSE STAGE</small><strong>' + esc(statusLabel(work.status)) + '</strong></div></div>' +
      '<p class="muted">' + esc(work.hold_reason || "Warehouse execution is tracked separately from the Zhipster shipment status.") + '</p>' +
      '<h3 style="font:700 12px Manrope">Shipment article lines</h3><div class="table-wrap"><table class="modal-lines"><thead><tr><th>SUPPLIER ARTICLE</th><th>BUYER ARTICLE</th><th>DESCRIPTION</th><th>REQUESTED</th><th>CONFIRMED</th><th>DISPATCHED</th></tr></thead><tbody>' +
      lines(s).map(function (l) {
        return '<tr><td>' + esc(l.supplier_article_number || "—") + '</td><td>' + esc(l.buyer_article_number || "—") + '</td><td>' + esc(l.description || "—") + '</td><td>' + esc(l.requested_quantity == null ? "—" : l.requested_quantity) + '</td><td>' + esc(l.confirmed_quantity == null ? "—" : l.confirmed_quantity) + '</td><td>' + esc(l.dispatched_quantity == null ? "—" : l.dispatched_quantity) + '</td></tr>';
      }).join("") + '</tbody></table></div>' +
      (canReview ? '<div class="modal-actions"><button class="btn primary" id="approveWarehouse" ' + (isDrop ? "disabled" : "") + '>Approve for picking</button><button class="btn" id="excludeWarehouse">Exclude from picking</button><button class="btn" id="holdWarehouse">Put on hold</button></div>' : '') +
      '<div class="modal-actions"><button class="btn" onclick="closeModal()">Close</button></div>' +
      '<p class="muted" style="margin-top:12px">Warehouse actions are saved to the WMS database and audit history. They do not change the source shipment in Zhipster.</p>';
    $("#modal").classList.add("show");

    const review = async function (eligibility, reason) {
      try {
        await operate({ action: "review", shipmentId: s.id, eligibility: eligibility, reason: reason }, "Warehouse review saved.");
        showWmsShipment(s.id);
      } catch (e) { toast(e.message); }
    };
    const approve = $("#approveWarehouse");
    const exclude = $("#excludeWarehouse");
    const hold = $("#holdWarehouse");
    if (approve) approve.onclick = function () { review("eligible", "Approved for own-warehouse fulfilment."); };
    if (exclude) exclude.onclick = function () { review("not_eligible", isDrop ? "DropShipment is fulfilled outside this warehouse." : "Excluded from warehouse fulfilment."); };
    if (hold) hold.onclick = function () { review("on_hold", "Placed on hold for manual review."); };
  };

  renderPicking = function () {
    const q = ($("#pickSearch") ? $("#pickSearch").value : "").trim().toLowerCase();
    const statusFilter = $("#pickStatus") ? $("#pickStatus").value : "";
    const grouped = {};
    wmsShipments.forEach(function (s) {
      const work = getWork(s), task = getTask(s);
      if (!["ready_to_pick", "picking"].includes(work.status)) return;
      (task.lines || []).forEach(function (pl) {
        const source = lines(s).find(function (l) { return l.id === pl.shipment_line_id; });
        if (!source) return;
        const sku = source.buyer_article_number || source.supplier_article_number || "Unmapped article";
        const desc = source.description || "Article";
        if (q && !(sku + " " + desc).toLowerCase().includes(q)) return;
        const done = Number(pl.quantity_picked || 0) >= Number(pl.quantity_to_pick || 0);
        if (statusFilter === "todo" && done) return;
        if (statusFilter === "done" && !done) return;
        (grouped[sku] || (grouped[sku] = { description: desc, items: [] })).items.push({ shipment: s, source: source, pick: pl, task: task });
      });
    });
    const host = $("#pickGroups");
    if (!host) return;
    host.innerHTML = Object.keys(grouped).sort().map(function (sku) {
      const group = grouped[sku];
      const total = group.items.reduce(function (n, x) { return n + Number(x.pick.quantity_to_pick || 0); }, 0);
      const picked = group.items.reduce(function (n, x) { return n + Number(x.pick.quantity_picked || 0); }, 0);
      return '<article class="pick-group"><div class="pick-group-head"><div class="sku-icon">▧</div><div><strong>' + esc(group.description) + '</strong><small>Article ' + esc(sku) + ' · ' + group.items.length + ' order line(s)</small></div><div class="pick-total"><b>' + picked + '/' + total + '</b><small>UNITS PICKED</small></div></div><div class="pick-lines">' +
        group.items.map(function (x) {
          const id = "pickqty-" + x.pick.shipment_line_id;
          return '<div class="pick-line"><div><strong>' + esc(x.shipment.external_order_number || x.shipment.external_shipment_number || x.shipment.external_shipment_id) + '</strong><small>' + esc(x.shipment.external_shipment_id) + '</small></div><div><strong>' + esc(sku) + '</strong><small>' + esc(x.source.description || "—") + '</small></div><div class="qty">' + Number(x.pick.quantity_picked || 0) + '/' + Number(x.pick.quantity_to_pick || 0) + ' pcs</div><div><small>Update picked qty</small><input id="' + id + '" type="number" min="0" max="' + Number(x.pick.quantity_to_pick || 0) + '" step="1" value="' + Number(x.pick.quantity_picked || 0) + '" style="width:76px;padding:6px;border:1px solid #dfe5ed;border-radius:6px"></div><button class="pick-check" data-save-pick="' + esc(x.task.id) + '|' + esc(x.pick.shipment_line_id) + '|' + id + '">Save</button></div>';
        }).join("") + '</div></article>';
    }).join("") || '<div class="panel empty-state"><div>⌑</div><h3>No open picking tasks</h3><p>Review eligible incoming orders to create warehouse picking work.</p></div>';
    $$("[data-save-pick]").forEach(function (button) {
      button.onclick = async function () {
        const parts = button.dataset.savePick.split("|");
        const input = document.getElementById(parts[2]);
        try {
          await operate({ action: "pick", pickTaskId: parts[0], shipmentLineId: parts[1], quantityPicked: Number(input.value) }, "Picking quantity saved.");
        } catch (e) { toast(e.message); }
      };
    });
  };

  let selectedWmsPack = null;
  renderPacking = function () {
    const list = wmsShipments.filter(function (s) { return getWork(s).status === "packing"; });
    const host = $("#packingOrders");
    if (!host) return;
    host.innerHTML = list.map(function (s) {
      return '<div class="packing-order"><div class="sku-icon">▣</div><div><strong>Order ' + esc(s.external_order_number || s.external_shipment_number || s.external_shipment_id) + '</strong><small>' + esc(s.external_shipment_id) + ' · ' + lines(s).length + ' lines</small></div><button data-wms-pack="' + esc(s.id) + '">Open →</button></div>';
    }).join("") || '<div class="empty-state"><div>✓</div><h3>Nothing to pack</h3><p>Orders appear here when all pick quantities are complete.</p></div>';
    $$("[data-wms-pack]").forEach(function (b) { b.onclick = function () { selectedWmsPack = b.dataset.wmsPack; showWmsPackDetail(); }; });
    if (selectedWmsPack && list.some(function (s) { return s.id === selectedWmsPack; })) showWmsPackDetail();
    else $("#packDetail").innerHTML = '<div class="empty-state"><div>▣</div><h3>Select an order</h3><p>Choose a completed picking task to enter its package details.</p></div>';
  };

  function showWmsPackDetail() {
    const s = currentShipment(selectedWmsPack);
    if (!s) return;
    const work = getWork(s);
    $("#packDetail").innerHTML =
      '<div class="panel-head"><div><div class="eyebrow">PACKING ORDER</div><h2>' + esc(s.external_order_number || s.external_shipment_number || s.external_shipment_id) + '</h2><p class="muted">Shipment ' + esc(s.external_shipment_id) + '</p></div></div>' +
      '<h3 style="font:700 12px Manrope">Verify picked quantities</h3><div class="pack-items">' +
      (getTask(s).lines || []).map(function (pl) {
        const source = lines(s).find(function (l) { return l.id === pl.shipment_line_id; }) || {};
        return '<div class="pack-item"><span>' + esc(source.buyer_article_number || source.supplier_article_number || "Article") + ' · ' + esc(source.description || "") + '</span><strong>' + Number(pl.quantity_picked || 0) + '/' + Number(pl.quantity_to_pick || 0) + '</strong></div>';
      }).join("") + '</div><h3 style="font:700 12px Manrope">Package details</h3><div class="pack-form">' +
      '<label>Package type<input id="wmsPackType" value="parcel"></label>' +
      '<label>Weight (kg)<input id="wmsPackWeight" type="number" min="0.01" step="0.01" value="1"></label>' +
      '<label>Length (cm)<input id="wmsPackLength" type="number" min="0.01" step="0.1" value="60"></label>' +
      '<label>Width (cm)<input id="wmsPackWidth" type="number" min="0.01" step="0.1" value="40"></label>' +
      '<label>Height (cm)<input id="wmsPackHeight" type="number" min="0.01" step="0.1" value="30"></label></div>' +
      '<p class="muted" style="margin:10px 0">Enter measured package data. No demo parcel profile is applied automatically.</p>' +
      '<button class="btn primary" id="wmsCompletePack">Save package &amp; mark ready for dispatch</button>';
    $("#wmsCompletePack").onclick = async function () {
      try {
        await operate({
          action: "pack", warehouseWorkId: work.id,
          packageType: $("#wmsPackType").value,
          weightKg: $("#wmsPackWeight").value,
          lengthCm: $("#wmsPackLength").value,
          widthCm: $("#wmsPackWidth").value,
          heightCm: $("#wmsPackHeight").value
        }, "Package saved. Order is ready for dispatch.");
        selectedWmsPack = null;
        renderPacking();
      } catch (e) { toast(e.message); }
    };
  }

  renderShipping = function () {
    const rows = wmsShipments.filter(function (s) {
      return ["ready_to_dispatch", "dispatched"].includes(getWork(s).status);
    });
    const host = $("#shippingRows");
    if (!host) return;
    host.innerHTML = rows.map(function (s) {
      const work = getWork(s), pkg = (work.packages || []).slice(-1)[0], dispatch = (work.dispatches || [])[0];
      let action = "";
      if (dispatch && dispatch.status === "prepared") {
        action = '<button class="btn primary" data-confirm-dispatch="' + esc(dispatch.id) + '">Confirm carrier handover</button>';
      } else if (work.status === "ready_to_dispatch") {
        action = '<button class="btn" data-prepare-dispatch="' + esc(work.id) + '">Prepare dispatch</button>';
      } else {
        action = '<span class="status-chip status-shipped">Handed over</span>';
      }
      return '<tr><td><strong>' + esc(s.external_order_number || s.external_shipment_number || s.external_shipment_id) + '</strong><span class="sub-cell">' + esc(s.external_shipment_id) + '</span></td><td>' + esc(dispatch && dispatch.carrier || "Not selected") + '</td><td>' + esc(dispatch && dispatch.tracking_reference || "—") + '</td><td>' + esc(pkg && pkg.weight_kg || "—") + ' kg</td><td>' + esc(pkg ? pkg.length_cm + " × " + pkg.width_cm + " × " + pkg.height_cm + " cm" : "—") + '</td><td>' + action + '</td></tr>';
    }).join("") || '<tr><td colspan="6" class="muted">No packed shipments are waiting for dispatch.</td></tr>';

    $$("[data-prepare-dispatch]").forEach(function (b) {
      b.onclick = async function () {
        const carrier = window.prompt("Carrier name (required):");
        if (!carrier) return;
        const tracking = window.prompt("Tracking reference (optional):") || "";
        try { await operate({ action: "prepare_dispatch", warehouseWorkId: b.dataset.prepareDispatch, carrier: carrier, trackingReference: tracking }, "Dispatch prepared. Confirm handover when the carrier physically collects it."); }
        catch (e) { toast(e.message); }
      };
    });
    $$("[data-confirm-dispatch]").forEach(function (b) {
      b.onclick = async function () {
        if (!window.confirm("Confirm that the carrier has physically taken custody of this shipment?")) return;
        try { await operate({ action: "confirm_dispatch", dispatchId: b.dataset.confirmDispatch }, "Carrier handover recorded."); }
        catch (e) { toast(e.message); }
      };
    });
  };

  if ($("#pickSearch")) $("#pickSearch").addEventListener("input", renderPicking);
  if ($("#pickStatus")) $("#pickStatus").addEventListener("change", renderPicking);
  const shippingNotice = document.querySelector("#page-shipping .notice");
  if (shippingNotice) shippingNotice.innerHTML = '<span>!</span><div><strong>Dispatch handover is recorded in Zhister only</strong><p>Carrier booking, label creation and shipment write-back to Zhipster are not enabled until the corresponding API contract is verified.</p></div>';
  const overviewDate = document.querySelector("#page-overview .eyebrow");
  if (overviewDate) overviewDate.textContent = new Intl.DateTimeFormat("en-GB", { weekday: "long", day: "numeric", month: "long", year: "numeric" }).format(new Date()).toUpperCase();
  const stockNotice = document.querySelector("#page-products .panel-head .muted");
  if (stockNotice) stockNotice.textContent = "Reference product catalogue only. Current stock quantities are demo values and must not be used for live allocation.";
  const syncPill = document.querySelector(".sync-pill");
  if (syncPill) syncPill.innerHTML = '<i></i> Warehouse execution · Zhipster source';

  loadWmsShipments();
})();