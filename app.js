const PRODUCTS=[
 {sku:"99566",name:"Wc-sits Ifö Sign Mjuksits",location:"A1",stock:18,allocated:4},
 {sku:"99420",name:"Wc-sits Ifö Cera Mjuksits",location:"A1",stock:16,allocated:3},
 {sku:"99488",name:"Wc-sits Ifö Spira Mjuksits",location:"A1",stock:22,allocated:5},
 {sku:"629309311",name:"WC-stol Ifö Spira 6293 Hårdsits",location:"A1",stock:12,allocated:2},
 {sku:"629308811",name:"WC-stol Ifö Spira 6293 Rimfree inkl Mjuksits",location:"A1",stock:18,allocated:6}
];
const KEY="zhister-wms-demo-v1";
// Remove the retired prototype orders from this browser. Real WMS orders will be loaded from Supabase.
localStorage.removeItem(KEY);
let orders=[];
let wmsShipments=[];
let selectedPack=null;
const $=s=>document.querySelector(s), $$=s=>[...document.querySelectorAll(s)];
const product=sku=>PRODUCTS.find(p=>p.sku===sku);
const qty=o=>o.lines.reduce((s,l)=>s+l.qty,0);
const statusClass=s=>({"Open":"status-open","Picking":"status-picking","Packing":"status-packing","Ready to ship":"status-ready","Shipped":"status-shipped"}[s]||"status-open");
const badge=s=>`<span class="status-chip ${statusClass(s)}">${s}</span>`;
function save(){localStorage.setItem(KEY,JSON.stringify(orders));renderAll()}
function toast(t){let el=$("#toast");el.textContent=t;el.classList.add("show");setTimeout(()=>el.classList.remove("show"),2400)}
function go(page){$$(".page").forEach(p=>p.classList.toggle("active",p.id==="page-"+page));$$(".nav-item").forEach(n=>n.classList.toggle("active",n.dataset.page===page));$("#crumb").textContent=page[0].toUpperCase()+page.slice(1);$("#sidebar").classList.remove("open");if(page==="packing")renderPacking();if(page==="picking")renderPicking();if(page==="shipping")renderShipping()}
$$("[data-page]").forEach(b=>b.addEventListener("click",()=>go(b.dataset.page)));
$$("[data-goto]").forEach(b=>b.addEventListener("click",()=>go(b.dataset.goto)));
$("#mobileMenu").onclick=()=>$("#sidebar").classList.toggle("open");
function renderOverview(){
 const total=wmsShipments.length,review=wmsShipments.filter(s=>s.eligibility==="needs_review").length,eligible=wmsShipments.filter(s=>s.eligibility==="eligible").length,excluded=wmsShipments.filter(s=>s.eligibility==="not_eligible").length;
 $("#statOpen").textContent=total;$("#statPick").textContent=review;$("#statShip").textContent=eligible;$("#statPicked").textContent=wmsShipments.reduce((n,s)=>n+(s.shipment_lines||[]).length,0);
 $("#flowOpen").textContent=total;$("#flowPicking").textContent=review;$("#flowPacking").textContent=eligible;$("#flowShip").textContent=excluded;
 $("#recentRows").innerHTML=wmsShipments.slice(0,5).map(s=>`<tr><td><button class="order-link" data-wms-shipment="${safeText(s.id)}">${safeText(s.external_order_number||s.external_shipment_number||s.external_shipment_id)}</button><span class="sub-cell">${safeText(s.external_shipment_number||s.external_shipment_id)}</span></td><td>${safeText(s.source_status||"Unknown")}</td><td>${safeText(s.distribution_model||"Not supplied")}</td><td>${(s.shipment_lines||[]).length} lines</td><td>${badge(s.eligibility==="eligible"?"Ready to pick":s.eligibility==="not_eligible"?"Excluded":"Needs review")}</td><td><button class="text-btn" data-wms-shipment="${safeText(s.id)}">Details →</button></td></tr>`).join("")||'<tr><td colspan="6" class="muted">No shipments imported yet. Use Live orders to retrieve an existing Zhipster order.</td></tr>';
 $("#orderNavCount").textContent=total;
 $$("[data-wms-shipment]").forEach(b=>b.onclick=()=>showWmsShipment(b.dataset.wmsShipment));
}
function renderOrders(){
 const q=$("#orderSearch").value.toLowerCase(),eligibility=$("#statusFilter").value;
 const rows=wmsShipments.filter(s=>(!eligibility||s.eligibility===eligibility)&&(!q||[s.id,s.external_shipment_id,s.external_shipment_number,s.external_order_number,s.source_status,s.distribution_model,...(s.shipment_lines||[]).flatMap(l=>[l.supplier_article_number,l.buyer_article_number,l.description])].join(" ").toLowerCase().includes(q)));
 $("#orderCount").textContent=rows.length;
 $("#orderRows").innerHTML=rows.map(s=>`<tr><td><button class="order-link" data-wms-shipment="${safeText(s.id)}">${safeText(s.external_order_number||"—")}</button><span class="sub-cell">${safeText(s.external_shipment_number||s.external_shipment_id)}</span></td><td>${safeText(s.source_status||"Unknown")}</td><td>${safeText(s.distribution_model||"Not supplied")}</td><td>${(s.shipment_lines||[]).length}</td><td>${(s.shipment_lines||[]).reduce((n,l)=>n+Number(l.requested_quantity||0),0)}</td><td>${safeText(s.eligibility||"needs_review")}</td><td><button class="text-btn" data-wms-shipment="${safeText(s.id)}">Details →</button></td></tr>`).join("")||'<tr><td colspan="7" class="muted">No imported shipments match. Go to Live orders and search an existing Zhipster Order Number.</td></tr>';
 $$("[data-wms-shipment]").forEach(b=>b.onclick=()=>showWmsShipment(b.dataset.wmsShipment));
}
function showWmsShipment(id){
 const s=wmsShipments.find(x=>x.id===id);if(!s)return;
 const lines=s.shipment_lines||[],work=s.warehouse_work||{};
 $("#modalContent").innerHTML=`<div class="eyebrow">ZHIPSTER SHIPMENT / ${safeText(s.external_shipment_id)}</div><h2>${safeText(s.external_shipment_number||s.external_order_number||"Shipment")}</h2><p class="muted">Order reference: ${safeText(s.external_order_number||"Not supplied")}</p><div class="detail-grid"><div class="detail-box"><small>ZHIPSTER STATUS</small><strong>${safeText(s.source_status||"Unknown")}</strong></div><div class="detail-box"><small>DISTRIBUTION MODEL</small><strong>${safeText(s.distribution_model||"Not supplied")}</strong></div><div class="detail-box"><small>WAREHOUSE ELIGIBILITY</small><strong>${safeText(s.eligibility||"needs_review")}</strong></div><div class="detail-box"><small>ARTICLE LINES</small><strong>${lines.length}</strong></div></div><p class="muted">${safeText(work.hold_reason||"Warehouse work remains on hold until fulfilment eligibility is reviewed.")}</p><h3 style="font:700 12px Manrope">Shipment article lines</h3><div class="table-wrap"><table class="modal-lines"><thead><tr><th>SUPPLIER ITEM NO.</th><th>BUYER ARTICLE NO.</th><th>DESCRIPTION</th><th>REQUESTED</th><th>CONFIRMED</th><th>DISPATCHED</th></tr></thead><tbody>${lines.map(l=>`<tr><td>${safeText(l.supplier_article_number||"—")}</td><td>${safeText(l.buyer_article_number||"—")}</td><td>${safeText(l.description||"—")}</td><td>${safeText(l.requested_quantity??"—")}</td><td>${safeText(l.confirmed_quantity??"—")}</td><td>${safeText(l.dispatched_quantity??"—")}</td></tr>`).join("")||'<tr><td colspan="6">No article lines returned.</td></tr>'}</tbody></table></div><div class="modal-actions"><button class="btn" onclick="closeModal()">Close</button></div>`;
 $("#modal").classList.add("show");
}
async function loadWmsShipments(){
 try{
  const response=await fetch("/api/wms/shipments",{headers:{Accept:"application/json"},cache:"no-store"});
  if(!response.ok)return;
  const body=await response.json();
  wmsShipments=Array.isArray(body.shipments)?body.shipments:[];
  renderOverview();renderOrders();$("#reportOrders").textContent=wmsShipments.length;
 }catch(error){console.warn("Could not load WMS shipments.");}
}
function showOrder(num){
 let o=orders.find(x=>x.number===num);if(!o)return;
 $("#modalContent").innerHTML=`<div class="eyebrow">ORDER / ${o.id}</div><h2>Order #${o.number}</h2><p class="muted">${o.customer} · Created ${o.date}</p><div class="detail-grid"><div class="detail-box"><small>STATUS</small><strong>${o.status}</strong></div><div class="detail-box"><small>CARRIER</small><strong>${o.carrier}</strong></div><div class="detail-box"><small>ORDER LINES</small><strong>${o.lines.length}</strong></div><div class="detail-box"><small>TOTAL QUANTITY</small><strong>${qty(o)} units</strong></div></div><h3 style="font:700 12px Manrope">Order lines</h3><table class="modal-lines"><thead><tr><th>ARTICLE</th><th>PRODUCT</th><th>QTY</th><th>PICKED</th></tr></thead><tbody>${o.lines.map(l=>`<tr><td>${l.sku}</td><td>${product(l.sku)?.name||"Unknown item"}</td><td>${l.qty}</td><td>${l.picked}</td></tr>`).join("")}</tbody></table><div class="modal-actions"><button class="btn" onclick="closeModal()">Close</button><button class="btn primary" onclick="closeModal();go('picking')">Open picking</button></div>`;
 $("#modal").classList.add("show");
}
function closeModal(){$("#modal").classList.remove("show")}
$("#modalClose").onclick=closeModal;$("#modal").onclick=e=>{if(e.target.id==="modal")closeModal()};
function renderProducts(){
 let q=$("#productSearch").value.toLowerCase(),loc=$("#productLocation").value;
 let rows=PRODUCTS.filter(p=>(!loc||p.location===loc)&&(!q||(p.sku+" "+p.name).toLowerCase().includes(q)));
 $("#productRows").innerHTML=rows.map(p=>`<tr><td><strong>${p.sku}</strong></td><td class="customer">${p.name}</td><td><span class="status-chip status-shipped">${p.location}</span></td><td>${p.stock}</td><td>${p.allocated}</td><td><strong>${p.stock-p.allocated}</strong></td></tr>`).join("");
 $("#locSkus").textContent=PRODUCTS.length;$("#locUnits").textContent=PRODUCTS.reduce((a,p)=>a+p.stock,0);$("#reportStock").textContent=PRODUCTS.reduce((a,p)=>a+p.stock,0);
 $("#locationProducts").innerHTML=PRODUCTS.map(p=>`<div class="loc-product"><span><strong>${p.sku}</strong> · ${p.name}</span><span>${p.stock} units</span></div>`).join("");
}
function renderPicking(){
 let q=$("#pickSearch").value.toLowerCase(),loc=$("#locationFilter").value,filter=$("#pickStatus").value;
 let grouped={};
 orders.filter(o=>["Open","Picking"].includes(o.status)).forEach(o=>o.lines.forEach((l,i)=>{
  let p=product(l.sku);if(!p|| (loc&&p.location!==loc)||(q&&!(p.sku+" "+p.name).toLowerCase().includes(q)))return;
  let key=l.sku;(grouped[key]??=[]).push({o,l,p});
 }));
 let groups=Object.entries(grouped).filter(([sku,items])=>filter==="done"?items.every(x=>x.l.picked>=x.l.qty):filter==="todo"?items.some(x=>x.l.picked<x.l.qty):true);
 $("#pickGroups").innerHTML=groups.map(([sku,items])=>{let p=product(sku),total=items.reduce((a,x)=>a+x.l.qty,0),done=items.reduce((a,x)=>a+Math.min(x.l.picked,x.l.qty),0);return `<article class="pick-group"><div class="pick-group-head"><div class="sku-icon">▧</div><div><strong>${p.name}</strong><small>Article ${sku} · Location ${p.location} · ${items.length} orders</small></div><div class="pick-total"><b>${done}/${total}</b><small>UNITS PICKED</small></div></div><div class="pick-lines">${items.map(({o,l})=>`<div class="pick-line"><div><strong>Order #${o.number}</strong><small>${o.customer}</small></div><div><strong>${sku}</strong><small>${o.id}</small></div><div class="qty">${l.picked}/${l.qty} pcs</div><div><small>Pick location</small><strong>${p.location}</strong></div><button class="pick-check ${l.picked>=l.qty?"done":""}" data-pick="${o.number}|${sku}">${l.picked>=l.qty?"✓ Picked":"+ Mark picked"}</button></div>`).join("")}</div></article>`}).join("")||`<div class="panel empty-state"><div>⌑</div><h3>No picking lines found</h3><p>Try clearing the filters or check orders in Open / Picking status.</p></div>`;
 $$("[data-pick]").forEach(b=>b.onclick=()=>{let [num,sku]=b.dataset.pick.split("|"),o=orders.find(x=>x.number===num),l=o.lines.find(x=>x.sku===sku);l.picked=l.picked>=l.qty?0:l.qty;if(o.lines.every(x=>x.picked>=x.qty))o.status="Packing";else o.status="Picking";save();toast("Picking progress updated")});
}
function renderPacking(){
 let list=orders.filter(o=>o.status==="Packing");
 $("#packingOrders").innerHTML=list.map(o=>`<div class="packing-order"><div class="sku-icon">▣</div><div><strong>Order #${o.number}</strong><small>${o.customer} · ${qty(o)} units</small></div><button data-pack="${o.number}">Open →</button></div>`).join("")||`<div class="empty-state"><div>✓</div><h3>Nothing to pack</h3><p>Orders appear here when all quantities are picked.</p></div>`;
 $$("[data-pack]").forEach(b=>b.onclick=()=>{selectedPack=b.dataset.pack;showPackDetail()});
 if(selectedPack&&list.some(o=>o.number===selectedPack))showPackDetail();else $("#packDetail").innerHTML=`<div class="empty-state"><div>▣</div><h3>Select an order</h3><p>Choose an order to verify its items and package details.</p></div>`;
}
function showPackDetail(){
 let o=orders.find(x=>x.number===selectedPack);if(!o)return;
 $("#packDetail").innerHTML=`<div class="panel-head"><div><div class="eyebrow">PACKING ORDER</div><h2>Order #${o.number}</h2><p class="muted">${o.customer} · ${o.id}</p></div>${badge(o.status)}</div><h3 style="font:700 12px Manrope">Verify picked items</h3><div class="pack-items">${o.lines.map(l=>`<div class="pack-item"><span>${l.sku} · ${product(l.sku).name}</span><strong>${l.picked}/${l.qty}</strong></div>`).join("")}</div><h3 style="font:700 12px Manrope">Package details</h3><div class="pack-form"><label>Weight (kg)<input id="packWeight" type="number" value="${o.weight||45}" min="0"></label><label>Length (cm)<input id="packLength" type="number" value="${o.package?.length||60}"></label><label>Width (cm)<input id="packWidth" type="number" value="${o.package?.width||80}"></label><label>Height (cm)<input id="packHeight" type="number" value="${o.package?.height||95}"></label></div><p class="muted" style="margin:10px 0">Demo half-pallet profile · 45 kg · 60 × 80 × 95 cm</p><button class="btn primary" id="completePack">Save package &amp; mark ready to ship</button>`;
 $("#completePack").onclick=()=>{o.weight=Number($("#packWeight").value);o.package={length:Number($("#packLength").value),width:Number($("#packWidth").value),height:Number($("#packHeight").value)};if(o.lines.some(l=>l.picked<l.qty)){toast("All order quantities must be picked first");return}o.status="Ready to ship";save();selectedPack=null;toast("Demo package saved")};
}
function renderShipping(){
 let list=orders.filter(o=>["Ready to ship","Shipped"].includes(o.status));
 $("#shippingRows").innerHTML=list.map(o=>`<tr><td><strong>#${o.number}</strong><span class="sub-cell">${o.id}</span></td><td>${o.customer}</td><td>${o.carrier}</td><td>${o.weight||"—"} kg</td><td>${o.package?`${o.package.length} × ${o.package.width} × ${o.package.height} cm`:"Not recorded"}</td><td>${badge(o.status)}</td></tr>`).join("")||`<tr><td colspan="6" class="muted">No packed orders in queue.</td></tr>`;
}
function csv(name,rows){let text=rows.map(r=>r.map(v=>`"${String(v??"").replace(/"/g,'""')}"`).join(",")).join("\n");let a=document.createElement("a"),url=URL.createObjectURL(new Blob(["\ufeff"+text],{type:"text/csv;charset=utf-8"}));a.href=url;a.download=name;a.click();URL.revokeObjectURL(url)}
function exportOrders(){csv("zhister-orders.csv",[["WMS shipment ID","Zhipster shipment number","Order number","Source status","Distribution model","Eligibility","Supplier article","Buyer article","Description","Requested","Confirmed","Dispatched"],...wmsShipments.flatMap(s=>(s.shipment_lines||[]).map(l=>[s.external_shipment_id,s.external_shipment_number,s.external_order_number,s.source_status,s.distribution_model,s.eligibility,l.supplier_article_number,l.buyer_article_number,l.description,l.requested_quantity,l.confirmed_quantity,l.dispatched_quantity]))])}
function exportProducts(){csv("zhister-products-demo.csv",[["Article number","Product","Location","On hand","Allocated","Available"],...PRODUCTS.map(p=>[p.sku,p.name,p.location,p.stock,p.allocated,p.stock-p.allocated])])}

function safeText(value){
 return String(value??"").replace(/[&<>"']/g,ch=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[ch]));
}
function collectShipments(data){
 if(Array.isArray(data))return data;
 if(!data||typeof data!=="object")return [];
 if(data.Shipment&&typeof data.Shipment==="object")return [data];
 for(const key of ["Shipments","ShipmentList","shipments","shipmentList","Items","items"]){
  if(Array.isArray(data[key]))return data[key].map(x=>x.Shipment?x:{Shipment:x});
 }
 return data.ShipmentKey||data.ShipmentNumber?[data]:[];
}

const LIVE_SHIPMENTS_KEY="zhister-wms-live-shipment-index-v1";
let liveShipments=JSON.parse(localStorage.getItem(LIVE_SHIPMENTS_KEY)||"[]");
function liveShipmentSearchText(record){
 const s=record.Shipment||record.shipment||record;
 const dispatch=Array.isArray(s.DispatchOrders)?s.DispatchOrders:(record.DispatchOrders||[]);
 const lines=dispatch.flatMap(d=>Array.isArray(d.DispatchOrderLines)?d.DispatchOrderLines:[]);
 const orderNumbers=dispatch.flatMap(d=>(d.OrderReferences?.Orders||[]).map(x=>x.OrderNumber));
 return [s.ShipmentNumber,s.ShipmentStatus,s.TransportInformation?.ShippingReference,s.TransportInformation?.DeliveryReference,s.TransportInformation?.DistributionModel,...orderNumbers,...lines.flatMap(l=>[l.SuppliersArticleNumber,l.BuyersArticleNumber,l.ManufacturersArticleNumber,l.ArticleDescription,l.DispatchLineStatus])].join(" ").toLowerCase();
}
function rememberLiveShipments(records){
 const byKey=new Map(liveShipments.map(x=>{const s=x.Shipment||x.shipment||x;return [s.ShipmentKey||s.ShipmentNumber,x]}));
 records.forEach(x=>{const s=x.Shipment||x.shipment||x;const key=s.ShipmentKey||s.ShipmentNumber;if(key)byKey.set(key,x)});
 liveShipments=[...byKey.values()];
 localStorage.setItem(LIVE_SHIPMENTS_KEY,JSON.stringify(liveShipments));
 renderLiveShipmentIndex();
}
function renderLiveShipmentIndex(){
 const host=$("#zhipsterLookupResult");if(!host)return;
 const q=($("#liveItemSearch")?.value||"").trim().toLowerCase();
 const matches=liveShipments.filter(x=>!q||liveShipmentSearchText(x).includes(q));
 const count=$("#liveShipmentCount");if(count)count.textContent=matches.length+" matching / "+liveShipments.length+" retrieved";
 if(!liveShipments.length){host.innerHTML='<p class="lookup-empty">No live shipments retrieved yet. Search an Order Number above to build this browser index.</p>';return}
 host.innerHTML=matches.length?matches.map(shipmentCard).join(""):'<p class="lookup-empty">No retrieved shipment lines match this search.</p>';
}

function classifyShipment(shipment,dispatch,lines){
 const model=String(shipment.TransportInformation?.DistributionModel||shipment.DistributionModel||"").trim();
 const normalized=model.toLowerCase().replace(/[^a-z]/g,"");
 if(normalized==="dropshipment"||normalized==="dropship"){
  return {label:"Excluded from warehouse picking",kind:"excluded",reason:"DropShipment indicates this shipment is handled outside the warehouse picking flow. It must not become a WMS pick task."};
 }
 if(!model){
  return {label:"Review required",kind:"review",reason:"Zhipster did not provide a distribution model. Fulfilment responsibility cannot be established from shipment status alone."};
 }
 if(!dispatch.length||!lines.length){
  return {label:"Review required",kind:"review",reason:"The shipment has a distribution model, but dispatch orders or article lines are missing. The warehouse workload cannot be verified."};
 }
 return {label:"Review required",kind:"review",reason:`Distribution model "${model}" has not yet been explicitly mapped to an own-warehouse fulfilment rule. No picking task will be created.`};
}
function shipmentCard(record,index){
 const s=record.Shipment||record.shipment||record;
 const dispatch=Array.isArray(s.DispatchOrders)?s.DispatchOrders:(Array.isArray(record.DispatchOrders)?record.DispatchOrders:[]);
 const lines=dispatch.flatMap(d=>Array.isArray(d.DispatchOrderLines)?d.DispatchOrderLines:[]);
 const shipmentStatus=s.ShipmentStatus||"Unknown";
 const distribution=s.TransportInformation?.DistributionModel||s.DistributionModel||"Not supplied";
 const orderRefs=dispatch.flatMap(d=>d.OrderReferences?.Orders||[]);
 const orderNo=orderRefs.map(x=>x.OrderNumber).filter(Boolean).join(", ")||s.ShipmentNumber||"—";
 const lineRows=lines.length?lines.map(l=>({supplier:l.SuppliersArticleNumber||"—",buyer:l.BuyersArticleNumber||"—",description:l.ArticleDescription||"—",requested:l.RequestedQuantity??"—",confirmed:l.ConfirmedQuantity??"—",dispatched:l.DispatchedQuantity??"—",price:l.RequestedPrice??"—",amount:l.RequestedLineAmount??"—",status:l.DispatchLineStatus||"—"})):[];
 
 return `<article class="live-shipment-card">
  <div class="live-shipment-head"><div><span class="eyebrow">ZHIPSTER SHIPMENT ${index+1}</span><h3>${safeText(s.ShipmentNumber||s.ShipmentKey||"Shipment")}</h3></div><span class="status-chip status-open">${safeText(shipmentStatus)}</span></div>
  <div class="live-shipment-grid">
   <div><small>Shipment ID</small><strong>${safeText(s.ShipmentKey||"—")}</strong></div>
   <div><small>Order reference</small><strong>${safeText(orderNo)}</strong></div>
   <div><small>Distribution model</small><strong>${safeText(distribution)}</strong></div>
   <div><small>Dispatch orders</small><strong>${dispatch.length}</strong></div>
  </div>
  ${lineRows.length?`<div class="table-wrap"><table><thead><tr><th>SUPPLIER ITEM NO.</th><th>BUYER ARTICLE NO.</th><th>DESCRIPTION</th><th>REQUESTED</th><th>CONFIRMED</th><th>DISPATCHED</th><th>PRICE</th><th>LINE AMOUNT</th><th>LINE STATUS</th></tr></thead><tbody>${lineRows.map(l=>`<tr><td><strong>${safeText(l.supplier)}</strong></td><td>${safeText(l.buyer)}</td><td>${safeText(l.description)}</td><td>${safeText(l.requested)}</td><td>${safeText(l.confirmed)}</td><td>${safeText(l.dispatched)}</td><td>${safeText(l.price)}</td><td>${safeText(l.amount)}</td><td>${safeText(l.status)}</td></tr>`).join("")}</tbody></table></div>`:`<p class="muted">No dispatch order lines were present in this response.</p>`}
  <p class="lookup-caution">Read-only Zhipster data. Distribution model and shipment status are displayed as supplied; no records are automatically excluded from the live results or imported into picking.</p>
 </article>`;
}
async function lookupZhipster(event){
 event.preventDefault();
 const value=$("#zhipsterLookupValue").value.trim();
 const result=$("#zhipsterLookupResult"),button=$("#zhipsterLookupButton");
 if(!value){result.textContent="Enter an Order Number first.";return}
 button.disabled=true;button.textContent="Importing…";result.textContent="Retrieving the existing shipment from Zhipster and saving it to WMS…";
 try{
  const response=await fetch("/api/wms/shipments",{method:"POST",headers:{"Content-Type":"application/json",Accept:"application/json"},body:JSON.stringify({orderNumber:value}),cache:"no-store"});
  const body=await response.json();
  if(!response.ok)throw new Error(body.error||`Import failed (HTTP ${response.status}).`);
  if(body.found===false){result.innerHTML='<p class="lookup-empty">No shipment was found for this Order Number.</p>';return}
  const shipments=collectShipments(body.sourceShipments||[]);
  if(shipments.length)rememberLiveShipments(shipments);
  await loadWmsShipments();
  result.insertAdjacentHTML("afterbegin",`<p class="lookup-success">${Number(body.imported||0)} shipment(s) saved to the WMS database. Existing Zhipster shipments were not changed.</p>`);
  toast("WMS shipment import complete.");
 }catch(error){
  result.innerHTML=`<p class="lookup-error">${safeText(error.message||"Could not complete the import.")}</p>`;
 }finally{
  button.disabled=false;button.textContent="Find order and import";
 }
}
$("#zhipsterLookupForm").addEventListener("submit",lookupZhipster);
$("#liveItemSearch").addEventListener("input",renderLiveShipmentIndex);
renderLiveShipmentIndex();

$("#orderSearch").oninput=renderOrders;$("#statusFilter").onchange=renderOrders;$("#clearFilters").onclick=()=>{$("#orderSearch").value="";$("#statusFilter").value="";renderOrders()};
$("#pickSearch").oninput=renderPicking;$("#locationFilter").onchange=renderPicking;$("#pickStatus").onchange=renderPicking;$("#productSearch").oninput=renderProducts;$("#productLocation").onchange=renderProducts;
$("#exportOrders").onclick=exportOrders;$("#reportOrdersExport").onclick=exportOrders;$("#exportProducts").onclick=exportProducts;$("#reportProductsExport").onclick=exportProducts;
$("#printPick").onclick=()=>window.print();$("#printReport").onclick=()=>window.print();
function renderAll(){renderOverview();renderOrders();renderProducts();renderPicking();renderPacking();renderShipping();$("#reportOrders").textContent=orders.length}
renderAll();
loadWmsShipments();
