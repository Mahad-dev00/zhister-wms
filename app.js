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
 const dateNode=$("#page-overview .page-head .eyebrow");if(dateNode)dateNode.textContent=new Intl.DateTimeFormat("en-GB",{weekday:"long",day:"numeric",month:"long",year:"numeric"}).format(new Date()).toUpperCase();
 const emptyNotice=$("#overviewEmptyNotice");if(emptyNotice)emptyNotice.hidden=wmsShipments.length>0;
 const total=wmsShipments.length,review=wmsShipments.filter(s=>s.eligibility==="needs_review").length,eligible=wmsShipments.filter(s=>s.eligibility==="eligible").length,excluded=wmsShipments.filter(s=>s.eligibility==="not_eligible").length;
 $("#statOpen").textContent=total;$("#statPick").textContent=review;$("#statShip").textContent=eligible;$("#statPicked").textContent=wmsShipments.reduce((n,s)=>n+(s.shipment_lines||[]).length,0);
 $("#flowOpen").textContent=total;$("#flowPicking").textContent=review;$("#flowPacking").textContent=eligible;$("#flowShip").textContent=excluded;
 $("#recentRows").innerHTML=wmsShipments.slice(0,5).map(s=>`<tr><td><button class="order-link" data-wms-shipment="${safeText(s.id)}">${safeText(s.external_order_number||s.external_shipment_number||s.external_shipment_id)}</button><span class="sub-cell">${safeText(s.external_shipment_number||s.external_shipment_id)}</span></td><td>${safeText(s.source_status||"Unknown")}</td><td>${safeText(s.distribution_model||"Not supplied")}</td><td>${(s.shipment_lines||[]).length} lines</td><td>${badge(s.eligibility==="eligible"?"Ready to pick":s.eligibility==="not_eligible"?"Excluded":"Needs review")}</td><td><button class="text-btn" data-wms-shipment="${safeText(s.id)}">Details →</button></td></tr>`).join("")||'<tr><td colspan="6" class="muted">No shipments imported yet. Use Live orders to retrieve an existing Zhipster order.</td></tr>';
 $("#orderNavCount").textContent=total;
 $$("[data-wms-shipment]").forEach(b=>b.onclick=()=>showWmsShipment(b.dataset.wmsShipment));
}
function renderOrders(){
 const q=$("#orderSearch").value.toLowerCase(),eligibility=$("#statusFilter").value;
 const rows=wmsShipments.filter(s=>(!eligibility||s.eligibility===eligibility)&&(!q||[s.id,s.external_shipment_id,s.external_shipment_number,s.external_order_number,s.source_status,s.distribution_model,s.customer?.name,s.customer?.postal_code,s.customer?.city,...(s.shipment_lines||[]).flatMap(l=>[l.supplier_article_number,l.buyer_article_number,l.description])].join(" ").toLowerCase().includes(q)));
 $("#orderCount").textContent=rows.length;
 $("#orderRows").innerHTML=rows.map(s=>{const c=s.customer||{},lines=s.shipment_lines||[];return `<tr><td><button class="order-link" data-wms-shipment="${safeText(s.id)}">${safeText(s.external_order_number||"—")}</button><span class="sub-cell">${safeText(s.external_shipment_number||s.external_shipment_id)}</span></td><td>${safeText(s.source_status||"Unknown")}</td><td>${safeText(s.distribution_model||"Not supplied")}</td><td><strong>${lines.length}</strong></td><td>${safeText(c.name||"Not supplied")}</td><td>${safeText([c.postal_code,c.city].filter(Boolean).join(" ")||"Not supplied")}</td><td>${safeText(s.eligibility||"needs_review")}</td><td><button class="text-btn" data-wms-shipment="${safeText(s.id)}">Details →</button></td></tr>`}).join("")||'<tr><td colspan="7" class="muted">No imported shipments match. Go to Live orders and search an existing Zhipster Order Number.</td></tr>';
 $$("[data-wms-shipment]").forEach(b=>b.onclick=()=>showWmsShipment(b.dataset.wmsShipment));
}
function showWmsShipment(id){
 const s=wmsShipments.find(x=>x.id===id);if(!s)return;
 const lines=s.shipment_lines||[],work=s.warehouse_work||{},customer=s.customer||{};
 $("#modalContent").innerHTML=`<div class="eyebrow">ZHIPSTER SHIPMENT / ${safeText(s.external_shipment_id)}</div><h2>${safeText(s.external_shipment_number||s.external_order_number||"Shipment")}</h2><p class="muted">Order reference: ${safeText(s.external_order_number||"Not supplied")}</p><div class="detail-grid"><div class="detail-box"><small>ZHIPSTER STATUS</small><strong>${safeText(s.source_status||"Unknown")}</strong></div><div class="detail-box"><small>DISTRIBUTION MODEL</small><strong>${safeText(s.distribution_model||"Not supplied")}</strong></div><div class="detail-box"><small>WAREHOUSE ELIGIBILITY</small><strong>${safeText(s.eligibility||"needs_review")}</strong></div><div class="detail-box"><small>ARTICLE LINES</small><strong>${lines.length}</strong></div></div><p class="muted">${safeText(work.hold_reason||"Warehouse work remains on hold until fulfilment eligibility is reviewed.")}</p><h3 style="font:700 12px Manrope">Shipment article lines</h3><div class="table-wrap"><table class="modal-lines"><thead><tr><th>SUPPLIER ITEM NO.</th><th>BUYER ARTICLE NO.</th><th>DESCRIPTION</th><th>REQUESTED</th><th>CONFIRMED</th><th>DISPATCHED</th></tr></thead><tbody>${lines.map(l=>`<tr><td>${safeText(l.supplier_article_number||"—")}</td><td>${safeText(l.buyer_article_number||"—")}</td><td>${safeText(l.description||"—")}</td><td>${safeText(l.requested_quantity??"—")}</td><td>${safeText(l.confirmed_quantity??"—")}</td><td>${safeText(l.dispatched_quantity??"—")}</td></tr>`).join("")||'<tr><td colspan="6">No article lines returned.</td></tr>'}</tbody></table></div><div class="modal-actions"><button class="btn" onclick="closeModal()">Close</button></div>`;
 $("#modal").classList.add("show");
}

function renderOperations(){
 const host=$("#operationsResults");if(!host)return;
 const q=($("#operationsSearch")?.value||"").trim().toLowerCase();
 const rows=wmsShipments.filter(s=>!q||[s.external_order_number,s.external_shipment_number,s.external_shipment_id,s.source_status,s.distribution_model,...(s.shipment_lines||[]).flatMap(l=>[l.supplier_article_number,l.buyer_article_number,l.description])].join(" ").toLowerCase().includes(q));
 $("#operationsSummary").textContent=rows.length+" matching orders · "+rows.reduce((n,s)=>n+(s.shipment_lines||[]).length,0)+" article lines · "+wmsShipments.length+" imported";
 if(!rows.length){host.innerHTML='<div class="empty-state"><h3>No matching imported orders</h3><p>Import an order above or change the search.</p></div>';return}
 host.innerHTML=rows.map(s=>{
  const lines=s.shipment_lines||[],work=s.warehouse_work||{},customer=s.customer||{},task=work.pick_task||{},taskLines=task.lines||[];
  const eligible=s.eligibility==="eligible"||work.eligibility==="eligible";
  const state=work.status||"not_started";
  let html='<article class="ops-order"><div class="ops-order-head"><div><span class="eyebrow">BYGGHEMMA ORDER</span><h3>'+safeText(s.external_order_number||"Order number unavailable")+'</h3><small>Shipment '+safeText(s.external_shipment_number||s.external_shipment_id||"—")+' · '+safeText(s.source_status||"Status unknown")+'</small></div><div><span class="status-chip '+(eligible?"status-ready":"status-open")+'">'+safeText(state.replace(/_/g," "))+'</span><p class="muted">'+safeText(s.distribution_model||"Distribution model not supplied")+'</p></div></div>';
  html+='<section class="ops-customer"><div><span class="eyebrow">CUSTOMER / DELIVERY TO</span><strong>'+safeText(customer.name||"Customer name not supplied")+'</strong><p>'+safeText([customer.street,customer.postal_code,customer.city,customer.country_code].filter(Boolean).join(", ")||"Delivery address not supplied")+'</p></div><div class="ops-customer-contact">'+(customer.phone?'<span>☎ '+safeText(customer.phone)+'</span>':'')+(customer.email?'<span>✉ '+safeText(customer.email)+'</span>':'')+(customer.drop_point_name?'<span>Pickup point: '+safeText(customer.drop_point_name)+'</span>':'')+'</div></section>';
  html+="<div class=\"ops-order-summary\"><div><small>ORDER NUMBER</small><strong>"+safeText(s.external_order_number||"—")+"</strong></div><div><small>ANTAL ARTIKLAR</small><strong>"+lines.length+"</strong></div><div><small>KUND</small><strong>"+safeText(customer.name||"Not supplied")+"</strong></div><div><small>POSTNR / ORT</small><strong>"+safeText([customer.postal_code,customer.city].filter(Boolean).join(" ")||"Not supplied")+"</strong></div></div>";
  if(s.eligibility==="needs_review"||!s.eligibility)html+='<div class="ops-actions"><span class="ops-note">Confirm warehouse fulfilment responsibility before picking.</span><button class="btn primary" data-review="'+s.id+'" data-eligibility="eligible">Approve for warehouse</button><button class="btn" data-review="'+s.id+'" data-eligibility="on_hold">Put on hold</button><button class="btn" data-review="'+s.id+'" data-eligibility="not_eligible">Exclude</button></div>';
  html+='<div class="table-wrap"><table class="ops-lines"><thead><tr><th>SUPPLIER ITEM NO.</th><th>BUYER ARTICLE NO.</th><th>DESCRIPTION</th><th>ORDERED QTY</th><th>CONFIRMED</th><th>DISPATCHED</th><th>PICKED / ACTION</th></tr></thead><tbody>';
  lines.forEach(l=>{
   const pl=taskLines.find(x=>x.shipment_line_id===l.id),toPick=Number(pl?.quantity_to_pick??l.requested_quantity??0),picked=Number(pl?.quantity_picked||0);
   html+='<tr><td><strong>'+safeText(l.supplier_article_number||"—")+'</strong></td><td>'+safeText(l.buyer_article_number||"—")+'</td><td>'+safeText(l.description||"—")+'</td><td class="ops-qty"><span class="ops-quantity-number">'+safeText(l.requested_quantity??"—")+'</span><span class="ops-quantity-label">PCS ORDERED</span></td><td>'+safeText(l.confirmed_quantity??"—")+'</td><td>'+safeText(l.dispatched_quantity??"—")+'</td><td>';
   if(pl&&["open","in_progress"].includes(task.status))html+='<div class="ops-pick-control"><input type="number" min="0" max="'+toPick+'" step="any" value="'+picked+'" id="picked-'+l.id+'"><button class="btn subtle" data-save-pick="'+l.id+'" data-task="'+task.id+'">Save</button><small>of '+toPick+'</small></div>';
   else if(pl)html+=picked+' / '+toPick;else html+='—';
   html+='</td></tr>';
  });
  if(!lines.length)html+='<tr><td colspan="7">No article lines stored.</td></tr>';
  html+='</tbody></table></div><div class="ops-footer">'+lines.length+' article lines · Eligibility: '+safeText(s.eligibility||"needs_review")+'</div>';
  if(eligible&&state==="packing")html+='<div class="ops-pack"><strong>Picking complete — record the actual package dimensions</strong><div class="ops-pack-grid"><label>Package type<input id="pack-type-'+work.id+'" value="parcel"></label><label>Weight kg<input id="pack-weight-'+work.id+'" type="number" min="0.01" step="0.01"></label><label>Length cm<input id="pack-length-'+work.id+'" type="number" min="0.01" step="0.01"></label><label>Width cm<input id="pack-width-'+work.id+'" type="number" min="0.01" step="0.01"></label><label>Height cm<input id="pack-height-'+work.id+'" type="number" min="0.01" step="0.01"></label><button class="btn primary" data-pack-shipment="'+work.id+'">Save package</button></div></div>';
  return html+'</article>';
 }).join("");
 host.querySelectorAll("[data-review]").forEach(b=>b.onclick=()=>runWarehouseAction({action:"review",shipmentId:b.dataset.review,eligibility:b.dataset.eligibility}));
 host.querySelectorAll("[data-save-pick]").forEach(b=>b.onclick=()=>runWarehouseAction({action:"pick",pickTaskId:b.dataset.task,shipmentLineId:b.dataset.savePick,quantityPicked:Number($("#picked-"+b.dataset.savePick).value)}));
 host.querySelectorAll("[data-pack-shipment]").forEach(b=>b.onclick=()=>{const id=b.dataset.packShipment;runWarehouseAction({action:"pack",warehouseWorkId:id,packageType:$("#pack-type-"+id).value,weightKg:Number($("#pack-weight-"+id).value),lengthCm:Number($("#pack-length-"+id).value),widthCm:Number($("#pack-width-"+id).value),heightCm:Number($("#pack-height-"+id).value)})});
}
async function runWarehouseAction(payload){
 try{const r=await fetch("/api/wms/shipments",{method:"POST",headers:{"Content-Type":"application/json",Accept:"application/json"},body:JSON.stringify(payload),cache:"no-store"});const b=await r.json();if(!r.ok)throw new Error(b.error||"Warehouse action failed");await loadWmsShipments();
renderOperations();toast("Warehouse update saved.");}
 catch(e){toast(e.message||"Could not save warehouse update.");}
}

async function loadWmsShipments(){
 try{
  const response=await fetch("/api/wms/shipments",{headers:{Accept:"application/json"},cache:"no-store"});
  if(!response.ok)return;
  const body=await response.json();
  wmsShipments=Array.isArray(body.shipments)?body.shipments:[];
  renderOverview();renderOrders();renderOperations();$("#reportOrders").textContent=wmsShipments.length;
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
$("#operationsSearch")?.addEventListener("input",renderOperations);
$("#refreshOperations")?.addEventListener("click",async()=>{await loadWmsShipments();renderOperations()});
renderLiveShipmentIndex();

$("#orderSearch").oninput=renderOrders;$("#statusFilter").onchange=renderOrders;$("#clearFilters").onclick=()=>{$("#orderSearch").value="";$("#statusFilter").value="";renderOrders()};
$("#pickSearch").oninput=renderPicking;$("#locationFilter").onchange=renderPicking;$("#pickStatus").onchange=renderPicking;$("#productSearch").oninput=renderProducts;$("#productLocation").onchange=renderProducts;
$("#exportOrders").onclick=exportOrders;$("#reportOrdersExport").onclick=exportOrders;$("#exportProducts").onclick=exportProducts;$("#reportProductsExport").onclick=exportProducts;
$("#printPick").onclick=()=>window.print();$("#printReport").onclick=()=>window.print();
function renderAll(){renderOverview();renderOrders();renderProducts();renderPicking();renderPacking();renderShipping();$("#reportOrders").textContent=orders.length}
renderAll();
loadWmsShipments();


/* Enterprise WMS interactions: client-side views over the existing WMS API. */
let orderSort={key:"created_at",direction:"desc"};
let orderPage=1;
let expandedOrders=new Set();
let ordersLoading=true;
let ordersLoadError="";
const workflowLabel=s=>{
 const w=s.warehouse_work||{},e=s.eligibility||w.eligibility||"needs_review",state=w.status||"not_started";
 if(e==="not_eligible")return "Excluded";
 if(e==="on_hold"||state==="on_hold")return "On hold";
 if(state==="dispatched")return "Shipped";
 if(state==="ready_to_dispatch")return "Packed";
 if(state==="packing")return "Picked";
 if(state==="picking")return "Picking";
 if(state==="ready_to_pick")return "Allocated";
 return "New";
};
const workflowClass=s=>({
 "New":"wms-new","On hold":"wms-hold","Partially allocated":"wms-partial",
 "Allocated":"wms-allocated","Picking":"wms-picking","Picked":"wms-picked",
 "Packed":"wms-packed","Shipped":"wms-shipped","Excluded":"wms-cancelled"
}[workflowLabel(s)]||"wms-new");
const wmsBadge=s=>'<span class="status-chip wms-status '+workflowClass(s)+'">'+safeText(workflowLabel(s))+'</span>';
const fmtDate=v=>v?new Intl.DateTimeFormat("en-GB",{dateStyle:"medium",timeStyle:"short"}).format(new Date(v)):"—";
const shipmentSearch=s=>{
 const c=s.customer||{};
 return [s.id,s.external_order_number,s.external_shipment_number,s.external_shipment_id,
 s.source_status,s.distribution_model,c.name,c.postal_code,c.city,c.street,
 ...(s.shipment_lines||[]).flatMap(l=>[l.supplier_article_number,l.buyer_article_number,l.description])]
 .join(" ").toLowerCase();
};
function filteredShipments(){
 const q=($("#orderSearch")?.value||"").trim().toLowerCase();
 const status=$("#statusFilter")?.value||"";
 const from=$("#orderDateFrom")?.value||"",to=$("#orderDateTo")?.value||"";
 return wmsShipments.filter(s=>{
  const label=workflowLabel(s),c=s.customer||{};
  const date=s.created_at?new Date(s.created_at):null;
  const dateKey=date&&!Number.isNaN(date.getTime())?date.toISOString().slice(0,10):"";
  const statusMatch=!status||
   (status==="needs_review"&&label==="New")||
   (status==="not_eligible"&&label==="Excluded")||
   (status==="on_hold"&&label==="On hold")||
   (status==="ready_to_pick"&&label==="Allocated")||
   (status==="picking"&&label==="Picking")||
   (status==="packing"&&label==="Picked")||
   (status==="ready_to_dispatch"&&label==="Packed")||
   (status==="dispatched"&&label==="Shipped");
  return statusMatch&&(!q||shipmentSearch(s).includes(q))&&(!from||(dateKey&&dateKey>=from))&&(!to||(dateKey&&dateKey<=to));
 });
}
function orderSortValue(s,key){
 const c=s.customer||{},w=s.warehouse_work||{};
 if(key==="workflow")return workflowLabel(s);
 if(key==="line_count")return (s.shipment_lines||[]).length;
 if(key==="customer")return c.name||"";
 if(key==="city")return [c.postal_code,c.city].join(" ");
 if(key==="created_at")return s.created_at||"";
 return s[key]||"";
}
function renderOrders(){
 const body=$("#orderRows");if(!body)return;
 const rows=filteredShipments().sort((a,b)=>{
  const av=orderSortValue(a,orderSort.key),bv=orderSortValue(b,orderSort.key);
  const cmp=typeof av==="number"&&typeof bv==="number"?av-bv:String(av).localeCompare(String(bv),undefined,{numeric:true,sensitivity:"base"});
  return orderSort.direction==="asc"?cmp:-cmp;
 });
 const size=Number($("#orderPageSize")?.value||10),pages=Math.max(1,Math.ceil(rows.length/size));
 orderPage=Math.min(orderPage,pages);
 const start=(orderPage-1)*size,visible=rows.slice(start,start+size);
 $("#orderCount").textContent=rows.length;
 $("#orderPageInfo").textContent=rows.length?("Showing "+(start+1)+"–"+Math.min(start+size,rows.length)+" of "+rows.length):"0 orders";
 $("#orderPageNumber").textContent=orderPage+" / "+pages;
 $("#orderPrev").disabled=orderPage<=1;$("#orderNext").disabled=orderPage>=pages;
 $$("[data-sort]").forEach(th=>{
  th.classList.toggle("sorted",th.dataset.sort===orderSort.key);
  const existing=th.querySelector(".sort-arrow");if(existing)existing.remove();
  const arrow=document.createElement("span");arrow.className="sort-arrow";
  arrow.textContent=th.dataset.sort===orderSort.key?(orderSort.direction==="asc"?" ↑":" ↓"):" ↕";
  th.appendChild(arrow);
 });
 if(ordersLoading&&!wmsShipments.length){
  body.innerHTML='<tr><td colspan="8"><div class="table-loading"><i></i><i></i><i></i></div>Loading warehouse orders…</td></tr>';return;
 }
 if(!visible.length){
  body.innerHTML='<tr><td colspan="8"><div class="table-empty"><strong>No orders found</strong><span>Change the filters or import a Bygghemma order from Receive order.</span></div></td></tr>';return;
 }
 body.innerHTML=visible.map(s=>{
  const c=s.customer||{},lines=s.shipment_lines||[],work=s.warehouse_work||{};
  const id=s.id;
  const expanded=expandedOrders.has(id);
  return '<tr class="order-data-row"><td><button class="expand-order" data-expand="'+safeText(id)+'" aria-expanded="'+expanded+'">'+(expanded?"−":"+")+'</button><button class="order-link" data-open-order="'+safeText(id)+'">'+safeText(s.external_order_number||"—")+'</button><span class="sub-cell">'+safeText(s.external_shipment_number||s.external_shipment_id||"")+'</span></td><td>'+wmsBadge(s)+'</td><td>'+safeText(s.distribution_model||"Not supplied")+'</td><td class="numeric">'+lines.length+'</td><td>'+safeText(c.name||"Not supplied")+'</td><td>'+safeText([c.postal_code,c.city].filter(Boolean).join(" ")||"Not supplied")+'</td><td>'+fmtDate(s.created_at)+'</td><td><button class="text-btn" data-expand="'+safeText(id)+'">'+(expanded?"Hide":"Details")+'</button></td></tr>'+
  (expanded?'<tr class="order-detail-row"><td colspan="8">'+orderDetailMarkup(s)+'</td></tr>':"");
 }).join("");
 body.querySelectorAll("[data-expand]").forEach(b=>b.onclick=()=>{const id=b.dataset.expand;expandedOrders.has(id)?expandedOrders.delete(id):expandedOrders.add(id);renderOrders();});
 body.querySelectorAll("[data-open-order]").forEach(b=>b.onclick=()=>showWmsShipment(b.dataset.openOrder));
 body.querySelectorAll("[data-load-history]").forEach(b=>b.onclick=()=>loadShipmentHistory(b.dataset.loadHistory));
}
function orderDetailMarkup(s){
 const lines=s.shipment_lines||[],work=s.warehouse_work||{},task=work.pick_task||{},taskLines=task.lines||[];
 const packages=work.packages||[],dispatches=work.dispatches||[];
 const c=s.customer||{};
 const progress=lines.reduce((n,l)=>{const pl=taskLines.find(x=>x.shipment_line_id===l.id);return n+(pl&&Number(pl.quantity_picked)>=Number(pl.quantity_to_pick)?1:0)},0);
 const rows=lines.map(l=>{
  const pl=taskLines.find(x=>x.shipment_line_id===l.id)||{};
  const packed=packages.length?Number(pl.quantity_picked||0):0;
  return '<tr><td><strong>'+safeText(l.supplier_article_number||"—")+'</strong></td><td>'+safeText(l.buyer_article_number||"—")+'</td><td>'+safeText(l.description||"—")+'</td><td class="numeric">'+safeText(l.requested_quantity??"—")+'</td><td class="numeric">'+safeText(pl.quantity_to_pick??0)+'</td><td class="numeric">'+safeText(pl.quantity_picked??0)+'</td><td class="numeric">'+packed+'</td><td>Not assigned</td></tr>';
 }).join("");
 return '<div class="order-detail"><div class="detail-summary"><div><small>DELIVER TO</small><strong>'+safeText(c.name||"Not supplied")+'</strong><span>'+safeText([c.street,c.postal_code,c.city].filter(Boolean).join(", ")||"Address not supplied")+'</span></div><div><small>WAREHOUSE PROGRESS</small><strong>'+progress+' of '+lines.length+' lines picked</strong><span>'+safeText(work.hold_reason||"No active hold reason")+'</span></div><div><small>PACKAGES / DISPATCHES</small><strong>'+packages.length+' / '+dispatches.length+'</strong><span>Created '+fmtDate(s.created_at)+'</span></div></div><div class="table-wrap"><table class="detail-lines-table"><thead><tr><th>SUPPLIER ITEM</th><th>BUYER ARTICLE</th><th>DESCRIPTION</th><th>ORDERED</th><th>ALLOCATED</th><th>PICKED</th><th>PACKED</th><th>LOCATION</th></tr></thead><tbody>'+(rows||'<tr><td colspan="8">No article lines saved.</td></tr>')+'</tbody></table></div><div class="history-head"><strong>Activity history</strong><button class="btn subtle" data-load-history="'+safeText(s.id)+'">Load history</button></div><div class="shipment-history" id="history-'+safeText(s.id)+'"><span class="muted">Load audit history for this shipment.</span></div></div>';
}
async function loadShipmentHistory(id){
 const host=$("#history-"+CSS.escape(id));if(!host)return;
 host.textContent="Loading activity history…";
 try{
  const r=await fetch("/api/wms/shipments?historyFor="+encodeURIComponent(id),{headers:{Accept:"application/json"},cache:"no-store"});
  const body=await r.json();if(!r.ok)throw new Error(body.error||"Could not load history.");
  const history=Array.isArray(body.history)?body.history:[];
  host.innerHTML=history.length?'<ol class="history-list">'+history.map(h=>'<li><time>'+fmtDate(h.occurred_at)+'</time><strong>'+safeText(String(h.action||"update").replace(/_/g," "))+'</strong><span>'+safeText(JSON.stringify(h.details||{}))+'</span></li>').join("")+'</ol>':'<span class="muted">No recorded activity yet.</span>';
 }catch(e){host.innerHTML='<span class="inline-error">'+safeText(e.message)+'</span>'}
}
function exportOrders(){
 const rows=filteredShipments();
 csv("zhister-wms-orders.csv",[["Order number","Shipment number","Shipment ID","Customer","Postcode","City","Source status","Workflow status","Distribution model","Article","Description","Ordered","Confirmed","Dispatched"],...rows.flatMap(s=>(s.shipment_lines||[]).map(l=>[s.external_order_number,s.external_shipment_number,s.external_shipment_id,s.customer?.name,s.customer?.postal_code,s.customer?.city,s.source_status,workflowLabel(s),s.distribution_model,l.supplier_article_number,l.description,l.requested_quantity,l.confirmed_quantity,l.dispatched_quantity]))]);
}
async function loadWmsShipments(){
 const body=$("#orderRows");if(body&&!wmsShipments.length)body.innerHTML='<tr><td colspan="8"><div class="table-loading"><i></i><i></i><i></i></div>Loading warehouse orders…</td></tr>';
 ordersLoading=true;ordersLoadError="";
 try{
  const response=await fetch("/api/wms/shipments",{headers:{Accept:"application/json"},cache:"no-store"});
  const data=await response.json().catch(()=>({}));
  if(!response.ok)throw new Error(data.error||"Could not load warehouse orders.");
  wmsShipments=Array.isArray(data.shipments)?data.shipments:[];
  ordersLoading=false;renderOverview();renderOrders();renderOperations();renderPicking();renderPacking();renderShipping();
  $("#reportOrders").textContent=wmsShipments.length;
  const alert=$("#appAlert");if(alert){alert.hidden=true;alert.textContent=""}
 }catch(error){
  ordersLoading=false;ordersLoadError=error.message||"Warehouse data could not be loaded.";
  const alert=$("#appAlert");if(alert){alert.hidden=false;alert.className="inline-alert error";alert.textContent=ordersLoadError}
  renderOrders();
 }
}
function renderPicking(){
 const host=$("#pickGroups");if(!host)return;
 const q=($("#pickSearch")?.value||"").trim().toLowerCase();
 const filter=$("#pickStatus")?.value||"";
 const locationFilter=$("#locationFilter")?.value||"";
 const groups=new Map();
 const pickable=wmsShipments.filter(s=>{
  const w=s.warehouse_work||{},t=w.pick_task||{};
  return ["open","in_progress","completed"].includes(t.status)&&w.eligibility==="eligible";
 });
 pickable.forEach(s=>{
  const w=s.warehouse_work||{},task=w.pick_task||{},c=s.customer||{};
  (s.shipment_lines||[]).forEach(l=>{
   const pl=(task.lines||[]).find(x=>x.shipment_line_id===l.id);if(!pl)return;
   if(locationFilter==="A1")return;
   const sku=l.supplier_article_number||l.buyer_article_number||"Uncoded";
   const text=[sku,l.buyer_article_number,l.description].join(" ").toLowerCase();
   const done=Number(pl.quantity_picked)>=Number(pl.quantity_to_pick);
   if(q&&!text.includes(q)&&!shipmentSearch(s).includes(q))return;
   if(filter==="todo"&&done)return;if(filter==="done"&&!done)return;
   if(!groups.has(sku))groups.set(sku,{sku,description:l.description||"Article description unavailable",rows:[]});
   groups.get(sku).rows.push({s,l,pl,task,c});
  });
 });
 if(!pickable.length){host.innerHTML='<div class="panel empty-state"><h3>No approved picking tasks</h3><p>Review and approve eligible shipments in Warehouse operations before picking. Drop shipments remain excluded.</p></div>';return}
 if(!groups.size){host.innerHTML='<div class="panel empty-state"><h3>No matching pick lines</h3><p>Clear the article search or change the work-status filter.</p></div>';return}
 host.innerHTML=[...groups.values()].map(g=>{
  const total=g.rows.reduce((n,x)=>n+Number(x.pl.quantity_to_pick||0),0),done=g.rows.reduce((n,x)=>n+Number(x.pl.quantity_picked||0),0);
  return '<article class="pick-group"><div class="pick-group-head"><div class="sku-icon">▧</div><div><strong>'+safeText(g.description)+'</strong><small>Article '+safeText(g.sku)+' · '+g.rows.length+' order lines</small></div><div class="pick-total"><b>'+done+' / '+total+'</b><small>UNITS PICKED</small></div></div><div class="pick-lines">'+g.rows.map(({s,l,pl,task,c})=>{
   const complete=Number(pl.quantity_picked)>=Number(pl.quantity_to_pick),progress=(s.shipment_lines||[]).filter(line=>(task.lines||[]).some(x=>x.shipment_line_id===line.id&&Number(x.quantity_picked)>=Number(x.quantity_to_pick))).length;
   const lineCount=(s.shipment_lines||[]).filter(line=>(task.lines||[]).some(x=>x.shipment_line_id===line.id)).length;
   return '<div class="pick-line enterprise-pick-line"><div><strong>Order '+safeText(s.external_order_number||s.external_shipment_number||"—")+'</strong><small>'+safeText(c.name||"Customer not supplied")+'</small><small>'+progress+' of '+lineCount+' lines picked</small></div><div><strong>'+safeText(g.sku)+'</strong><small>'+safeText(l.description||"")+'</small></div><div class="pick-location"><small>LOCATION</small><strong>Not assigned</strong></div><div class="pick-quantity"><small>QUANTITY</small><input type="number" min="0" max="'+Number(pl.quantity_to_pick)+'" step="any" value="'+Number(pl.quantity_picked)+'" id="pickqty-'+safeText(pl.shipment_line_id)+'" '+(complete?"disabled":"")+'></div><button class="btn primary pick-save" data-save-pick="'+safeText(pl.shipment_line_id)+'" data-task="'+safeText(task.id)+'" '+(complete?"disabled":"")+'>'+(complete?"Picked":"Save picked qty")+'</button></div>';
  }).join("")+'</div></article>';
 }).join("");
 host.querySelectorAll("[data-save-pick]").forEach(b=>b.onclick=()=>{
  const input=$("#pickqty-"+CSS.escape(b.dataset.savePick)),value=Number(input?.value);
  if(!input||!Number.isFinite(value)||value<0||value>Number(input.max)){toast("Enter a valid picked quantity within the required quantity.");return}
  runWarehouseAction({action:"pick",pickTaskId:b.dataset.task,shipmentLineId:b.dataset.savePick,quantityPicked:value});
 });
}
let selectedWmsPack=null;
function renderPacking(){
 const list=wmsShipments.filter(s=>(s.warehouse_work||{}).status==="packing");
 $("#packingOrders").innerHTML=list.length?list.map(s=>{
  const c=s.customer||{},lines=s.shipment_lines||[],task=s.warehouse_work?.pick_task||{};
  const done=(task.lines||[]).filter(l=>Number(l.quantity_picked)>=Number(l.quantity_to_pick)).length;
  return '<div class="packing-order"><div class="sku-icon">▣</div><div><strong>Order '+safeText(s.external_order_number||"—")+'</strong><small>'+safeText(c.name||"Customer not supplied")+' · '+lines.length+' lines · '+done+' / '+lines.length+' picked</small></div><button class="btn subtle" data-select-pack="'+safeText(s.id)+'">Open →</button></div>';
 }).join(""):'<div class="empty-state"><h3>Nothing to pack</h3><p>Orders appear here when all pick quantities have been confirmed.</p></div>';
 $("#packingOrders").querySelectorAll("[data-select-pack]").forEach(b=>b.onclick=()=>{selectedWmsPack=b.dataset.selectPack;showWmsPackDetail()});
 if(selectedWmsPack&&list.some(s=>s.id===selectedWmsPack))showWmsPackDetail();
 else if(!list.length)$("#packDetail").innerHTML='<div class="empty-state"><h3>No orders awaiting packing</h3><p>Completed pick tasks will appear here.</p></div>';
}
function showWmsPackDetail(){
 const s=wmsShipments.find(x=>x.id===selectedWmsPack);if(!s)return;
 const work=s.warehouse_work||{},task=work.pick_task||{},c=s.customer||{};
 const packages=work.packages||[];
 $("#packDetail").innerHTML='<div class="panel-head"><div><div class="eyebrow">PACKING ORDER</div><h2>Order '+safeText(s.external_order_number||"—")+'</h2><p class="muted">'+safeText(c.name||"Customer not supplied")+'</p></div>'+wmsBadge(s)+'</div><h3>Verify picked quantities</h3><div class="pack-items">'+(s.shipment_lines||[]).map(l=>{
  const pl=(task.lines||[]).find(x=>x.shipment_line_id===l.id)||{};
  return '<div class="pack-item"><span><strong>'+safeText(l.supplier_article_number||l.buyer_article_number||"—")+'</strong> · '+safeText(l.description||"")+'</span><strong>'+Number(pl.quantity_picked||0)+' / '+Number(pl.quantity_to_pick||l.requested_quantity||0)+'</strong></div>';
 }).join("")+'</div><h3>Package details</h3><div class="pack-form"><label>Package type<input id="wmsPackType" value="parcel" required></label><label>Weight (kg)<input id="wmsPackWeight" type="number" min="0.01" step="0.01" required></label><label>Length (cm)<input id="wmsPackLength" type="number" min="0.01" step="0.01" required></label><label>Width (cm)<input id="wmsPackWidth" type="number" min="0.01" step="0.01" required></label><label>Height (cm)<input id="wmsPackHeight" type="number" min="0.01" step="0.01" required></label></div><button class="btn primary" id="wmsSavePackage">Save package</button><div class="package-list">'+packages.map(p=>'<div class="package-row"><strong>Package '+p.package_number+'</strong><span>'+safeText(p.package_type||"Package")+' · '+safeText(p.weight_kg||"—")+' kg · '+safeText([p.length_cm,p.width_cm,p.height_cm].join(" × "))+' cm</span></div>').join("")+'</div>';
 $("#wmsSavePackage").onclick=()=>{
  const values=["wmsPackWeight","wmsPackLength","wmsPackWidth","wmsPackHeight"].map(id=>Number($("#"+id).value));
  if(values.some(v=>!Number.isFinite(v)||v<=0)){toast("Enter positive package weight and all three dimensions.");return}
  runWarehouseAction({action:"pack",warehouseWorkId:work.id,packageType:$("#wmsPackType").value,weightKg:values[0],lengthCm:values[1],widthCm:values[2],heightCm:values[3]});
 };
}
function renderShipping(){
 const rows=wmsShipments.filter(s=>["ready_to_dispatch","dispatched"].includes(s.warehouse_work?.status));
 $("#shippingRows").innerHTML=rows.length?rows.map(s=>{
  const c=s.customer||{},w=s.warehouse_work||{},ds=w.dispatches||[],latest=ds[0]||{};
  const form=w.status==="ready_to_dispatch"&&!ds.some(d=>d.status==="prepared");
  const confirm=latest.status==="prepared";
  return '<tr><td><strong>'+safeText(s.external_order_number||"—")+'</strong><span class="sub-cell">'+safeText(s.external_shipment_number||s.external_shipment_id)+'</span></td><td>'+safeText(c.name||"Not supplied")+'</td><td>'+safeText(latest.carrier||"Not recorded")+'</td><td>'+safeText((w.packages||[]).map(p=>p.weight_kg+" kg").join(", ")||"—")+'</td><td>'+safeText((w.packages||[]).map(p=>[p.length_cm,p.width_cm,p.height_cm].join(" × ")+" cm").join("; ")||"—")+'</td><td>'+wmsBadge(s)+'</td><td>'+(form?'<div class="dispatch-form"><input id="carrier-'+safeText(s.id)+'" placeholder="Carrier" aria-label="Carrier" required><input id="tracking-'+safeText(s.id)+'" placeholder="Tracking ref. (optional)" aria-label="Tracking reference"><button class="btn primary" data-prepare-dispatch="'+safeText(w.id)+'" data-shipment="'+safeText(s.id)+'">Prepare handover</button></div>':confirm?'<span class="muted">'+safeText(latest.carrier||"Carrier")+' · '+safeText(latest.tracking_reference||"No tracking ref.")+'</span><button class="btn primary" data-confirm-dispatch="'+safeText(latest.id)+'">Confirm carrier handover</button>':safeText(latest.status==="handed_over"?"Handed over":latest.status||"Dispatched"))+'</td></tr>';
 }).join(""):'<tr><td colspan="7"><div class="table-empty"><strong>No packed shipments in dispatch queue</strong><span>Fully packed warehouse orders will appear here. Carrier booking and labels remain in Zhipster.</span></div></td></tr>';
 $("#shippingRows").querySelectorAll("[data-prepare-dispatch]").forEach(b=>b.onclick=()=>{
  const carrier=$("#carrier-"+CSS.escape(b.dataset.shipment)).value.trim(),tracking=$("#tracking-"+CSS.escape(b.dataset.shipment)).value.trim();
  if(!carrier){toast("Enter the carrier before preparing dispatch.");return}
  runWarehouseAction({action:"dispatch_prepare",warehouseWorkId:b.dataset.prepareDispatch,carrier,trackingReference:tracking});
 });
 $("#shippingRows").querySelectorAll("[data-confirm-dispatch]").forEach(b=>b.onclick=()=>{
  if(!window.confirm("Confirm that this packed shipment has physically been handed to the carrier?"))return;
  runWarehouseAction({action:"dispatch_confirm",dispatchId:b.dataset.confirmDispatch});
 });
}
function showWmsShipment(id){
 const s=wmsShipments.find(x=>x.id===id);if(!s)return;
 const c=s.customer||{},w=s.warehouse_work||{},lines=s.shipment_lines||[],task=w.pick_task||{},taskLines=task.lines||[];
 $("#modalContent").innerHTML='<div class="eyebrow">ZHIPSTER SHIPMENT / '+safeText(s.external_shipment_id)+'</div><h2>'+safeText(s.external_order_number||s.external_shipment_number||"Shipment")+'</h2><p class="muted">'+safeText(c.name||"Customer not supplied")+' · '+safeText([c.street,c.postal_code,c.city].filter(Boolean).join(", "))+'</p><div class="detail-grid"><div class="detail-box"><small>ZHIPSTER STATUS</small><strong>'+safeText(s.source_status||"Unknown")+'</strong></div><div class="detail-box"><small>WORKFLOW STATUS</small><strong>'+safeText(workflowLabel(s))+'</strong></div><div class="detail-box"><small>DISTRIBUTION MODEL</small><strong>'+safeText(s.distribution_model||"Not supplied")+'</strong></div><div class="detail-box"><small>ARTICLE LINES</small><strong>'+lines.length+'</strong></div></div><p class="muted">'+safeText(w.hold_reason||"No active warehouse hold.")+'</p><div class="table-wrap"><table class="modal-lines"><thead><tr><th>SUPPLIER ITEM</th><th>BUYER ARTICLE</th><th>DESCRIPTION</th><th>ORDERED</th><th>ALLOCATED</th><th>PICKED</th></tr></thead><tbody>'+lines.map(l=>{const pl=taskLines.find(x=>x.shipment_line_id===l.id)||{};return '<tr><td>'+safeText(l.supplier_article_number||"—")+'</td><td>'+safeText(l.buyer_article_number||"—")+'</td><td>'+safeText(l.description||"—")+'</td><td>'+safeText(l.requested_quantity??"—")+'</td><td>'+safeText(pl.quantity_to_pick??0)+'</td><td>'+safeText(pl.quantity_picked??0)+'</td></tr>'}).join("")+'</tbody></table></div><div class="modal-actions"><button class="btn" onclick="closeModal()">Close</button></div>';
 $("#modal").classList.add("show");
}
function bindEnterpriseControls(){
 $("#orderSearch").oninput=()=>{orderPage=1;renderOrders()};
 $("#statusFilter").onchange=()=>{orderPage=1;renderOrders()};
 $("#orderDateFrom").onchange=()=>{orderPage=1;renderOrders()};
 $("#orderDateTo").onchange=()=>{orderPage=1;renderOrders()};
 $("#clearFilters").onclick=()=>{$("#orderSearch").value="";$("#statusFilter").value="";$("#orderDateFrom").value="";$("#orderDateTo").value="";orderPage=1;renderOrders()};
 $("#orderPageSize").onchange=()=>{orderPage=1;renderOrders()};
 $("#orderPrev").onclick=()=>{orderPage=Math.max(1,orderPage-1);renderOrders()};
 $("#orderNext").onclick=()=>{orderPage++;renderOrders()};
 $("#ordersTable").querySelectorAll("[data-sort]").forEach(th=>th.onclick=()=>{
  const key=th.dataset.sort;
  orderSort={key,direction:orderSort.key===key&&orderSort.direction==="asc"?"desc":"asc"};orderPage=1;renderOrders();
 });
 $("#globalSearch").addEventListener("keydown",e=>{
  if(e.key!=="Enter")return;
  const q=e.currentTarget.value.trim();if(!q)return;
  const match=wmsShipments.find(s=>shipmentSearch(s).includes(q.toLowerCase()));
  if(match){go("orders");$("#orderSearch").value=q;orderPage=1;renderOrders();expandedOrders.add(match.id);renderOrders();return}
  const productMatch=getImportedArticles().some(p=>(p.sku+" "+p.name).toLowerCase().includes(q.toLowerCase()));
  if(productMatch){go("products");$("#productSearch").value=q;renderProducts();return}
  go("orders");$("#orderSearch").value=q;orderPage=1;renderOrders();
 });
 $("#sidebarCollapse")?.addEventListener("click",()=>document.body.classList.toggle("sidebar-collapsed"));
}
bindEnterpriseControls();


async function runWarehouseAction(payload){
 const alert=$("#appAlert");
 try{
  const response=await fetch("/api/wms/shipments",{method:"POST",headers:{"Content-Type":"application/json",Accept:"application/json"},body:JSON.stringify(payload),cache:"no-store"});
  const data=await response.json().catch(()=>({}));
  if(!response.ok)throw new Error(data.error||"The warehouse update could not be saved.");
  if(alert){alert.hidden=true;alert.textContent=""}
  await loadWmsShipments();
  toast("Warehouse update saved.");
 }catch(error){
  if(alert){alert.hidden=false;alert.className="inline-alert error";alert.textContent=error.message||"The warehouse update could not be saved."}
  toast(error.message||"Could not save warehouse update.");
 }
}
function getImportedArticles(){
 const map=new Map();
 wmsShipments.forEach(s=>(s.shipment_lines||[]).forEach(l=>{
  const supplier=l.supplier_article_number||"",buyer=l.buyer_article_number||"";
  const key=supplier||buyer||("line:"+l.id);
  if(!map.has(key))map.set(key,{sku:key,supplier,buyer,name:l.description||"Description not supplied",orders:0,ordered:0});
  const a=map.get(key);a.orders++;a.ordered+=Number(l.requested_quantity||0);
  if((!a.name||a.name==="Description not supplied")&&l.description)a.name=l.description;
 }));
 return [...map.values()].sort((a,b)=>a.sku.localeCompare(b.sku,undefined,{numeric:true}));
}
function renderProducts(){
 const q=($("#productSearch")?.value||"").trim().toLowerCase();
 const rows=getImportedArticles().filter(a=>[a.sku,a.supplier,a.buyer,a.name].join(" ").toLowerCase().includes(q));
 $("#productRows").innerHTML=rows.length?rows.map(a=>'<tr><td><strong>'+safeText(a.sku)+'</strong></td><td>'+safeText(a.name)+'</td><td><span class="status-chip wms-new">Not assigned</span></td><td class="numeric muted">Not recorded</td><td class="numeric muted">—</td><td class="numeric muted">—</td></tr>').join(""):'<tr><td colspan="6"><div class="table-empty"><strong>No imported articles yet</strong><span>Article records are derived from shipment lines retrieved from Zhipster.</span></div></td></tr>';
 const count=getImportedArticles().length;
 if($("#reportSkus"))$("#reportSkus").textContent=count;
 const heading=$("#page-products .panel-head h2");if(heading)heading.innerHTML='Article catalogue <span class="count">'+count+'</span>';
 $("#locSkus").textContent="Not configured";
 $("#locUnits").textContent="Not recorded";
 $("#reportStock").textContent="Not recorded";
 $("#locationProducts").innerHTML='<div class="table-empty"><strong>Location master not configured</strong><span>Physical bin assignments and stock counts have not been entered in WMS.</span></div>';
}
function exportProducts(){
 const rows=getImportedArticles();
 csv("zhister-wms-articles.csv",[["Article number","Supplier article","Buyer article","Description","Orders referenced","Total ordered","Location","On hand","Allocated","Available"],...rows.map(a=>[a.sku,a.supplier,a.buyer,a.name,a.orders,a.ordered,"Not assigned","Not recorded","Not recorded","Not recorded"])]);
}
function renderAll(){
 renderOverview();renderOrders();renderProducts();renderPicking();renderPacking();renderShipping();
 $("#reportOrders").textContent=wmsShipments.length;
}
loadWmsShipments();
renderProducts();


let wmsInventory=[];
let wmsMovements=[];
async function loadWmsInventory(){
 try{
  const response=await fetch("/api/wms/inventory",{headers:{Accept:"application/json"},cache:"no-store"});
  const data=await response.json().catch(()=>({}));
  if(!response.ok)throw new Error(data.error||"Could not load inventory.");
  wmsInventory=Array.isArray(data.inventory)?data.inventory:[];
  wmsMovements=Array.isArray(data.movements)?data.movements:[];
  renderProducts();renderStock();renderMovements();renderLocations();renderStockForms();
 }catch(error){
  const alert=$("#appAlert");if(alert){alert.hidden=false;alert.className="inline-alert error";alert.textContent=error.message||"Inventory data could not be loaded."}
  const stock=$("#stockRows");if(stock)stock.innerHTML='<tr><td colspan="7"><div class="table-empty"><strong>Inventory unavailable</strong><span>Check the database connection and reload.</span></div></td></tr>';
 }
}
async function loadWmsShipments(){
 const body=$("#orderRows");
 ordersLoading=true;
 if(body&&!wmsShipments.length)body.innerHTML='<tr><td colspan="8"><div class="table-loading"><i></i><i></i><i></i></div>Loading warehouse orders…</td></tr>';
 try{
  const response=await fetch("/api/wms/shipments",{headers:{Accept:"application/json"},cache:"no-store"});
  const data=await response.json().catch(()=>({}));
  if(!response.ok)throw new Error(data.error||"Could not load warehouse orders.");
  wmsShipments=Array.isArray(data.shipments)?data.shipments:[];
  ordersLoading=false;renderOverview();renderOrders();renderOperations();renderPicking();renderPacking();renderShipping();
  $("#reportOrders").textContent=wmsShipments.length;
  await loadWmsInventory();
  const alert=$("#appAlert");if(alert){alert.hidden=true;alert.textContent=""}
 }catch(error){
  ordersLoading=false;const alert=$("#appAlert");if(alert){alert.hidden=false;alert.className="inline-alert error";alert.textContent=error.message||"Warehouse data could not be loaded."}
  renderOrders();
 }
}
function go(page){
 $$(".page").forEach(p=>p.classList.toggle("active",p.id==="page-"+page));
 $$(".nav-item").forEach(n=>n.classList.toggle("active",n.dataset.page===page));
 $("#crumb").textContent=page==="shipments"?"Import order":page==="movements"?"Stock movements":page[0].toUpperCase()+page.slice(1);
 $("#sidebar").classList.remove("open");
 if(page==="packing")renderPacking();
 if(page==="picking")renderPicking();
 if(page==="shipping")renderShipping();
 if(page==="products")renderProducts();
 if(page==="stock")renderStock();
 if(page==="movements")renderMovements();
 if(page==="locations")renderLocations();
 if(page==="receiving"||page==="adjustments")renderStockForms();
}
function renderProducts(){
 const q=($("#productSearch")?.value||"").trim().toLowerCase(),loc=$("#productLocation")?.value||"";
 const rows=wmsInventory.filter(a=>(!loc||a.location_code===loc)&&[a.article_code,a.supplier_article_number,a.buyer_article_number,a.description].join(" ").toLowerCase().includes(q));
 $("#productRows").innerHTML=rows.length?rows.map(a=>{
  const shortage=Number(a.available)<0,none=Number(a.on_hand)<=0;
  return '<tr><td><strong>'+safeText(a.article_code)+'</strong></td><td>'+safeText(a.description||"Description not supplied")+'</td><td><span class="status-chip wms-allocated">'+safeText(a.location_code)+'</span></td><td class="numeric">'+Number(a.on_hand)+'</td><td class="numeric '+(Number(a.allocated)>0?"stock-allocated":"")+'">'+Number(a.allocated)+'</td><td class="numeric '+(shortage||none?"stock-shortage":"")+'">'+Number(a.available)+'</td></tr>';
 }).join(""):'<tr><td colspan="6"><div class="table-empty"><strong>No articles in the warehouse master</strong><span>Import an order from Zhipster to register its article numbers.</span></div></td></tr>';
 const heading=$("#page-products .panel-head h2");if(heading)heading.innerHTML='Article catalogue <span class="count">'+wmsInventory.length+'</span>';
 if($("#reportSkus"))$("#reportSkus").textContent=wmsInventory.length;
 const total=wmsInventory.reduce((n,a)=>n+Number(a.on_hand||0),0);
 if($("#reportStock"))$("#reportStock").textContent=total;
}
function renderStock(){
 const host=$("#stockRows");if(!host)return;
 const q=($("#stockSearch")?.value||"").trim().toLowerCase(),loc=$("#stockLocation")?.value||"";
 const rows=wmsInventory.filter(a=>(!loc||a.location_code===loc)&&[a.article_code,a.description,a.supplier_article_number,a.buyer_article_number].join(" ").toLowerCase().includes(q));
 $("#stockCount").textContent=rows.length;
 host.innerHTML=rows.length?rows.map(a=>{
  const on=Number(a.on_hand),allocated=Number(a.allocated),available=Number(a.available);
  const status=available<0?"Shortage":on<=0?"No stock":available===0?"Fully allocated":"Available";
  const cls=available<0||on<=0?"wms-hold":available===0?"wms-partial":"wms-packed";
  return '<tr><td><strong>'+safeText(a.article_code)+'</strong></td><td>'+safeText(a.description||"—")+'</td><td>'+safeText(a.location_code)+'</td><td class="numeric">'+on+'</td><td class="numeric '+(allocated>0?"stock-allocated":"")+'">'+allocated+'</td><td class="numeric '+(available<=0?"stock-shortage":"")+'">'+available+'</td><td><span class="status-chip '+cls+'">'+status+'</span></td></tr>';
 }).join(""):'<tr><td colspan="7"><div class="table-empty"><strong>No stock records found</strong><span>Import articles and record stock receipts to establish balances.</span></div></td></tr>';
}
function renderMovements(){
 const host=$("#movementRows");if(!host)return;
 const q=($("#movementSearch")?.value||"").trim().toLowerCase(),type=$("#movementTypeFilter")?.value||"";
 const rows=wmsMovements.filter(m=>(!type||m.movement_type===type)&&[m.article_code,m.description,m.location_code,m.reference,m.note,m.movement_type].join(" ").toLowerCase().includes(q));
 $("#movementCount").textContent=rows.length;
 host.innerHTML=rows.length?rows.map(m=>{
  const delta=Number(m.quantity_delta),typeLabel=String(m.movement_type).replace(/_/g," ");
  return '<tr><td>'+fmtDate(m.created_at)+'</td><td><strong>'+safeText(m.article_code)+'</strong></td><td>'+safeText(m.description||"—")+'</td><td>'+safeText(m.location_code)+'</td><td><span class="status-chip '+(delta>0?"wms-packed":"wms-hold")+'">'+safeText(typeLabel)+'</span></td><td class="numeric '+(delta>0?"stock-in":"stock-out")+'">'+(delta>0?"+":"")+delta+'</td><td>'+safeText([m.reference,m.note].filter(Boolean).join(" · ")||"—")+'</td></tr>';
 }).join(""):'<tr><td colspan="7"><div class="table-empty"><strong>No stock movements yet</strong><span>Receipts, adjustments and completed picks will appear here.</span></div></td></tr>';
}
function renderLocations(){
 const units=wmsInventory.reduce((n,a)=>n+Number(a.on_hand||0),0);
 if($("#locSkus"))$("#locSkus").textContent=wmsInventory.length;
 if($("#locUnits"))$("#locUnits").textContent=units;
 if($("#locationProducts"))$("#locationProducts").innerHTML=wmsInventory.length?wmsInventory.map(a=>'<div class="loc-product"><span><strong>'+safeText(a.article_code)+'</strong> · '+safeText(a.description||"")+'</span><span>'+Number(a.on_hand)+' on hand · '+Number(a.allocated)+' allocated</span></div>').join(""):'<div class="table-empty"><strong>No articles assigned yet</strong><span>Imported article numbers appear here. Stock balances begin at zero until received.</span></div>';
}
function renderStockForms(){
 const options='<option value="">Select article</option>'+wmsInventory.map(a=>'<option value="'+safeText(a.article_code)+'">'+safeText(a.article_code+' · '+(a.description||""))+'</option>').join("");
 ["#receiptArticle","#adjustArticle"].forEach(sel=>{const el=$(sel);if(!el)return;const current=el.value;el.innerHTML=options;if(wmsInventory.some(a=>a.article_code===current))el.value=current});
}
function stockMessage(id,text,error=false){
 const el=$(id);if(!el)return;el.textContent=text;el.className="form-message "+(error?"error":"success");
}
async function submitStockMovement({articleCode,locationCode,quantityDelta,movementType,reference,note,messageId,form}){
 try{
  const response=await fetch("/api/wms/inventory",{method:"POST",headers:{"Content-Type":"application/json",Accept:"application/json"},body:JSON.stringify({articleCode,locationCode,quantityDelta,movementType,reference,note}),cache:"no-store"});
  const data=await response.json().catch(()=>({}));
  if(!response.ok)throw new Error(data.error||"Stock movement could not be saved.");
  stockMessage(messageId,"Stock ledger updated successfully.");
  if(form)form.reset();
  await loadWmsInventory();
  toast("Stock movement recorded.");
 }catch(error){stockMessage(messageId,error.message||"Could not save stock movement.",true)}
}
$("#receiptForm")?.addEventListener("submit",e=>{
 e.preventDefault();
 const quantity=Number($("#receiptQuantity").value);
 if(!Number.isFinite(quantity)||quantity<=0){stockMessage("#receiptMessage","Enter a positive received quantity.",true);return}
 submitStockMovement({articleCode:$("#receiptArticle").value,locationCode:$("#receiptLocation").value,quantityDelta:quantity,movementType:"receipt",reference:$("#receiptReference").value,note:$("#receiptNote").value,messageId:"#receiptMessage",form:$("#receiptForm")});
});
$("#adjustmentForm")?.addEventListener("submit",e=>{
 e.preventDefault();
 const quantity=Number($("#adjustQuantity").value),reason=$("#adjustReason").value.trim();
 if(!Number.isFinite(quantity)||quantity===0||!reason){stockMessage("#adjustmentMessage","Enter a non-zero quantity change and a reason.",true);return}
 submitStockMovement({articleCode:$("#adjustArticle").value,locationCode:$("#adjustLocation").value,quantityDelta:quantity,movementType:"adjustment",reference:reason,note:$("#adjustNote").value,messageId:"#adjustmentMessage",form:$("#adjustmentForm")});
});
$("#stockSearch")?.addEventListener("input",renderStock);
$("#stockLocation")?.addEventListener("change",renderStock);
$("#stockReset")?.addEventListener("click",()=>{$("#stockSearch").value="";$("#stockLocation").value="";renderStock()});
$("#movementSearch")?.addEventListener("input",renderMovements);
$("#movementTypeFilter")?.addEventListener("change",renderMovements);
$("#movementReset")?.addEventListener("click",()=>{$("#movementSearch").value="";$("#movementTypeFilter").value="";renderMovements()});
$("#exportStock")?.addEventListener("click",()=>csv("zhister-wms-stock.csv",[["Article","Description","Location","On hand","Allocated","Available"],...wmsInventory.map(a=>[a.article_code,a.description,a.location_code,a.on_hand,a.allocated,a.available])]));
$("#exportMovements")?.addEventListener("click",()=>csv("zhister-wms-stock-movements.csv",[["Date","Article","Description","Location","Movement type","Quantity change","Reference","Note"],...wmsMovements.map(m=>[m.created_at,m.article_code,m.description,m.location_code,m.movement_type,m.quantity_delta,m.reference,m.note])]));
async function runWarehouseAction(payload){
 const alert=$("#appAlert");
 try{
  const response=await fetch("/api/wms/shipments",{method:"POST",headers:{"Content-Type":"application/json",Accept:"application/json"},body:JSON.stringify(payload),cache:"no-store"});
  const data=await response.json().catch(()=>({}));
  if(!response.ok)throw new Error(data.error||"The warehouse update could not be saved.");
  if(alert){alert.hidden=true;alert.textContent=""}
  await loadWmsShipments();
  toast("Warehouse update saved.");
 }catch(error){
  if(alert){alert.hidden=false;alert.className="inline-alert error";alert.textContent=error.message||"The warehouse update could not be saved."}
  toast(error.message||"Could not save warehouse update.");
 }
}
$("#productLocation")?.addEventListener("change",renderProducts);
loadWmsShipments();

async function submitStockMovement({articleCode,locationCode,quantityDelta,movementType,reference,note,messageId,form}){
 const submit=form?.querySelector('button[type="submit"]');if(submit)submit.disabled=true;
 try{
  const response=await fetch("/api/wms/inventory",{method:"POST",headers:{"Content-Type":"application/json",Accept:"application/json"},body:JSON.stringify({articleCode,locationCode,quantityDelta,movementType,reference,note}),cache:"no-store"});
  const data=await response.json().catch(()=>({}));
  if(!response.ok)throw new Error(data.error||"Stock movement could not be saved.");
  stockMessage(messageId,"Stock ledger updated successfully.");
  if(form)form.reset();
  await loadWmsInventory();toast("Stock movement recorded.");
 }catch(error){stockMessage(messageId,error.message||"Could not save stock movement.",true)}
 finally{if(submit)submit.disabled=false}
}
function exportProducts(){
 csv("zhister-wms-articles-and-stock.csv",[["Article","Supplier article","Buyer article","Description","Location","On hand","Allocated","Available"],...wmsInventory.map(a=>[a.article_code,a.supplier_article_number,a.buyer_article_number,a.description,a.location_code,a.on_hand,a.allocated,a.available])]);
}
