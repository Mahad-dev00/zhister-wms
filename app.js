const PRODUCTS=[
 {sku:"99566",name:"Wc-sits Ifö Sign Mjuksits",location:"A1"},
 {sku:"99420",name:"Wc-sits Ifö Cera Mjuksits",location:"A1"},
 {sku:"99488",name:"Wc-sits Ifö Spira Mjuksits",location:"A1"},
 {sku:"629309311",name:"WC-stol Ifö Spira 6293 Hårdsits",location:"A1"},
 {sku:"629308811",name:"WC-stol Ifö Spira 6293 Rimfree inkl Mjuksits",location:"A1"}
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
 const rows=wmsShipments.filter(s=>(!eligibility||s.eligibility===eligibility)&&(!q||[s.id,s.external_shipment_id,s.external_shipment_number,s.external_order_number,s.source_status,s.distribution_model,s.customer?.name,s.customer?.postal_code,s.customer?.city,...(s.shipment_lines||[]).flatMap(l=>[l.supplier_article_number,l.buyer_article_number,l.description])].join(" ").toLowerCase().includes(q)));
 $("#orderCount").textContent=rows.length;
 $("#orderRows").innerHTML=rows.map(s=>{const c=s.customer||{},lines=s.shipment_lines||[];return `<tr><td><button class="order-link" data-wms-shipment="${safeText(s.id)}">${safeText(s.external_order_number||"—")}</button><span class="sub-cell">${safeText(s.external_shipment_number||s.external_shipment_id)}</span></td><td>${safeText(s.source_status||"Unknown")}</td><td>${safeText(s.distribution_model||"Not supplied")}</td><td><strong>${lines.length}</strong></td><td>${safeText(c.name||"Not supplied")}</td><td>${safeText([c.postal_code,c.city].filter(Boolean).join(" ")||"Not supplied")}</td><td>${safeText(s.eligibility||"needs_review")}</td><td><button class="text-btn" data-wms-shipment="${safeText(s.id)}">Details →</button></td></tr>`}).join("")||'<tr><td colspan="7" class="muted">No imported shipments match. Go to Live orders and search an existing Zhipster Order Number.</td></tr>';
 $$("[data-wms-shipment]").forEach(b=>b.onclick=()=>showWmsShipment(b.dataset.wmsShipment));
}
function showWmsShipment(id){
 const s=wmsShipments.find(x=>x.id===id);if(!s)return;
 const lines=s.shipment_lines||[],work=s.warehouse_work||{},customer=s.customer||{};
 $("#modalContent").innerHTML=`<div class="eyebrow">ZHIPSTER SHIPMENT / ${safeText(s.external_shipment_id)}</div><h2>${safeText(s.external_shipment_number||s.external_order_number||"Shipment")}</h2><p class="muted">Order reference: ${safeText(s.external_order_number||"Not supplied")}</p><div class="detail-grid"><div class="detail-box"><small>ZHIPSTER STATUS</small><strong>${safeText(s.source_status||"Unknown")}</strong></div><div class="detail-box"><small>DISTRIBUTION MODEL</small><strong>${safeText(s.distribution_model||"Not supplied")}</strong></div><div class="detail-box"><small>WAREHOUSE ELIGIBILITY</small><strong>${safeText(s.eligibility||"needs_review")}</strong></div><div class="detail-box"><small>ARTICLE LINES</small><strong>${lines.length}</strong></div></div><p class="muted">${safeText(work.hold_reason||"Warehouse work remains on hold until fulfilment eligibility is reviewed.")}</p><h3 style="font:700 12px Manrope">Shipment article lines</h3><div class="table-wrap"><table class="modal-lines"><thead><tr><th>SUPPLIER ITEM NO.</th><th>BUYER ARTICLE NO.</th><th>DESCRIPTION</th></tr></thead><tbody>${lines.map(l=>`<tr><td>${safeText(l.supplier_article_number||"—")}</td><td>${safeText(l.buyer_article_number||"—")}</td><td>${safeText(l.description||"—")}</td></tr>`).join("")||'<tr><td colspan="3">No article lines returned.</td></tr>'}</tbody></table></div><div class="modal-actions"><button class="btn" onclick="closeModal()">Close</button></div>`;
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
  if(s.eligibility==="needs_review"||!s.eligibility)html+='<div class="ops-actions"><span class="ops-note">Picking is unavailable until customer-specific quantities are verified.</span><button class="btn" data-review="'+s.id+'" data-eligibility="on_hold">Put on hold</button><button class="btn" data-review="'+s.id+'" data-eligibility="not_eligible">Exclude</button></div>';
  html+='<div class="table-wrap"><table class="ops-lines"><thead><tr><th>SUPPLIER ITEM NO.</th><th>BUYER ARTICLE NO.</th><th>DESCRIPTION</th></tr></thead><tbody>';
  lines.forEach(l=>{
   html+='<tr><td><strong>'+safeText(l.supplier_article_number||"—")+'</strong></td><td>'+safeText(l.buyer_article_number||"—")+'</td><td>'+safeText(l.description||"—")+'</td>';
   html+='</tr>';
  });
  if(!lines.length)html+='<tr><td colspan="3">No article lines stored.</td></tr>';
  html+='</tbody></table></div><div class="ops-footer">'+lines.length+' article lines · Eligibility: '+safeText(s.eligibility||"needs_review")+'</div>';
  if(eligible&&state==="packing")html+='<div class="ops-pack"><strong>Picking complete — record the actual package dimensions</strong><div class="ops-pack-grid"><label>Package type<input id="pack-type-'+work.id+'" value="parcel"></label><label>Weight kg<input id="pack-weight-'+work.id+'" type="number" min="0.01" step="0.01"></label><label>Length cm<input id="pack-length-'+work.id+'" type="number" min="0.01" step="0.01"></label><label>Width cm<input id="pack-width-'+work.id+'" type="number" min="0.01" step="0.01"></label><label>Height cm<input id="pack-height-'+work.id+'" type="number" min="0.01" step="0.01"></label><button class="btn primary" data-pack-shipment="'+work.id+'">Save package</button></div></div>';
  return html+'</article>';
 }).join("");
 host.querySelectorAll("[data-review]").forEach(b=>b.onclick=()=>runWarehouseAction({action:"review",shipmentId:b.dataset.review,eligibility:b.dataset.eligibility}));
 
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
 $("#productRows").innerHTML=rows.map(p=>`<tr><td><strong>${p.sku}</strong></td><td class="customer">${p.name}</td><td><span class="status-chip status-shipped">${p.location}</span></td></tr>`).join("");
 $("#locSkus").textContent=PRODUCTS.length;
 $("#locationProducts").innerHTML=PRODUCTS.map(p=>`<div class="loc-product"><span><strong>${p.sku}</strong> · ${p.name}</span></div>`).join("");
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
function exportOrders(){csv("zhister-orders.csv",[["WMS shipment ID","Zhipster shipment number","Order number","Source status","Distribution model","Eligibility","Supplier article","Buyer article","Description","Quantity"],...wmsShipments.flatMap(s=>(s.shipment_lines||[]).map(l=>[s.external_shipment_id,s.external_shipment_number,s.external_order_number,s.source_status,s.distribution_model,s.eligibility,l.supplier_article_number,l.buyer_article_number,l.description,l.requested_quantity]))])}
function exportProducts(){csv("zhister-products.csv",[["Article number","Product","Location"],...PRODUCTS.map(p=>[p.sku,p.name,p.location])])}

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

function classifyShipment(shipment,dispatch,lines){
 const model=String(shipment.TransportInformation?.DistributionModel||shipment.DistributionModel||"").trim();
 const normalized=model.toLowerCase().replace(/[^a-z]/g,"");
 if(normalized==="dropshipment"||normalized==="dropship"){
  return {label:"Warehouse fulfilment",kind:"review",reason:"DropShipment describes the shipping arrangement managed by Bygghemma. This order is still picked and prepared in your warehouse."};
 }
 if(!model){
  return {label:"Review required",kind:"review",reason:"Zhipster did not provide a distribution model. Fulfilment responsibility cannot be established from shipment status alone."};
 }
 if(!dispatch.length||!lines.length){
  return {label:"Review required",kind:"review",reason:"The shipment has a distribution model, but dispatch orders or article lines are missing. The warehouse workload cannot be verified."};
 }
 return {label:"Review required",kind:"review",reason:`Distribution model "${model}" has not yet been explicitly mapped to an own-warehouse fulfilment rule. No picking task will be created.`};
}
function zhisterLineQuantity(){ return null; }
function shipmentCard(record,index){
 const s=record.Shipment||record.shipment||record;
 const dispatch=Array.isArray(s.DispatchOrders)?s.DispatchOrders:(Array.isArray(record.DispatchOrders)?record.DispatchOrders:[]);
 const sourceLines=dispatch.flatMap(d=>Array.isArray(d.DispatchOrderLines)?d.DispatchOrderLines:[]);
 const orderRefs=dispatch.flatMap(d=>d.OrderReferences?.Orders||[]);
 const orderNo=orderRefs.map(x=>x.OrderNumber).filter(Boolean).join(", ")||s.ShipmentNumber||"—";
 const delivery=s.Delivery||{},address=delivery.Address||{},contact=delivery.Contact||{};
 const customerName=contact.Name||address.Name||"Customer not supplied";
 const addressText=[address.Street1,address.Street2,[address.ZipCode,address.City].filter(Boolean).join(" "),address.CountryCode].filter(Boolean).join(", ")||"Delivery address not supplied";
 const drop=s.DropPoint||{},dropAddress=drop.Address||{};
 const dropAddressText=[dropAddress.Street1,dropAddress.ZipCode,dropAddress.City].filter(Boolean).join(", ");
 const grouped=new Map();
 sourceLines.forEach(line=>{
  const key=[line.SuppliersArticleNumber||line.BuyersArticleNumber||"",line.BuyersArticleNumber||"",line.ArticleDescription||""].join("|");
  const qty=zhisterLineQuantity(line),existing=grouped.get(key);
  if(!existing)grouped.set(key,{supplier:line.SuppliersArticleNumber||"—",buyer:line.BuyersArticleNumber||"—",description:line.ArticleDescription||"—",quantity:qty});
  else if(qty!==null&&existing.quantity!==null)existing.quantity=Number((existing.quantity+qty).toFixed(3));
  else existing.quantity=null;
 });
 const lines=[...grouped.values()];
 const qtyText=value=>value===null||value===undefined?"Not supplied":String(value);
 return `<article class="live-shipment-card">
  <header class="live-shipment-head"><div><span class="eyebrow">ORDER</span><h3>${safeText(orderNo)}</h3><p class="live-order-reference">Shipment ${safeText(s.ShipmentNumber||"—")}</p></div><span class="status-chip status-open">${safeText(s.ShipmentStatus||"Status unavailable")}</span></header>
  <section class="live-customer-profile"><div class="live-customer-main"><div class="live-customer-identity"><span class="eyebrow">DELIVER TO</span><h4>${safeText(customerName)}</h4><p>${safeText(addressText)}</p></div></div><div class="live-customer-contact">${contact.PhoneNumber?`<a href="tel:${safeText(contact.PhoneNumber.replace(/[^+0-9]/g,""))}"><span>PHONE</span><strong>${safeText(contact.PhoneNumber)}</strong></a>`:""}${contact.EmailAddress?`<a href="mailto:${safeText(contact.EmailAddress)}"><span>EMAIL</span><strong>${safeText(contact.EmailAddress)}</strong></a>`:""}</div></section>
  ${drop.Name?`<section class="live-drop-point"><div class="live-drop-icon">⌖</div><div><span class="eyebrow">DELIVERY POINT</span><strong>${safeText(drop.Name)}</strong><p>${safeText(dropAddressText||"Address not supplied")}</p></div></section>`:""}
  <div class="live-lines-heading"><div><h4>Ordered products</h4><p>${lines.length} product line(s)</p></div></div>
  <div class="table-wrap"><table class="lookup-lines"><thead><tr><th>SUPPLIER ARTICLE</th><th>BUYER ARTICLE</th><th>PRODUCT</th></tr></thead><tbody>${lines.map(line=>`<tr><td>${safeText(line.supplier)}</td><td>${safeText(line.buyer)}</td><td>${safeText(line.description)}</td></tr>`).join("")||'<tr><td colspan="3">No product lines were returned by Zhipster.</td></tr>'}</tbody></table></div>
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
  await loadWmsShipments();
  result.innerHTML=`<p class="lookup-success">${Number(body.imported||0)} shipment(s) saved to the WMS database.</p>`+shipments.map(shipmentCard).join("");
  toast("WMS shipment import complete.");
 }catch(error){
  result.innerHTML=`<p class="lookup-error">${safeText(error.message||"Could not complete the import.")}</p>`;
 }finally{
  button.disabled=false;button.textContent="Find order and import";
 }
}
$("#zhipsterLookupForm").addEventListener("submit",lookupZhipster);
$("#operationsSearch")?.addEventListener("input",renderOperations);
$("#refreshOperations")?.addEventListener("click",async()=>{await loadWmsShipments();renderOperations()});
$("#orderSearch").oninput=renderOrders;$("#statusFilter").onchange=renderOrders;$("#clearFilters").onclick=()=>{$("#orderSearch").value="";$("#statusFilter").value="";renderOrders()};
$("#pickSearch").oninput=renderPicking;$("#locationFilter").onchange=renderPicking;$("#pickStatus").onchange=renderPicking;$("#productSearch").oninput=renderProducts;$("#productLocation").onchange=renderProducts;
$("#exportOrders").onclick=exportOrders;$("#reportOrdersExport").onclick=exportOrders;$("#exportProducts").onclick=exportProducts;$("#reportProductsExport").onclick=exportProducts;
$("#printPick").onclick=()=>window.print();$("#printReport").onclick=()=>window.print();
function renderAll(){renderOverview();renderOrders();renderProducts();renderPicking();renderPacking();renderShipping();$("#reportOrders").textContent=orders.length}
renderAll();
loadWmsShipments();
