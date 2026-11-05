const PRODUCTS=[
 {sku:"99566",name:"Wc-sits Ifö Sign Mjuksits",location:"A1",stock:18,allocated:4},
 {sku:"99420",name:"Wc-sits Ifö Cera Mjuksits",location:"A1",stock:16,allocated:3},
 {sku:"99488",name:"Wc-sits Ifö Spira Mjuksits",location:"A1",stock:22,allocated:5},
 {sku:"629309311",name:"WC-stol Ifö Spira 6293 Hårdsits",location:"A1",stock:12,allocated:2},
 {sku:"629308811",name:"WC-stol Ifö Spira 6293 Rimfree inkl Mjuksits",location:"A1",stock:18,allocated:6}
];
const seed=[
 ["9542","Vincent Dadvar","2026-11-03","DHL","Open",[["629308811",1],["99488",1]]],
 ["9541","Thomas Dahl","2026-11-03","DHL","Picking",[["99566",2]]],
 ["9540","Emma Lindström","2026-11-03","Bring","Open",[["99420",1],["99488",2]]],
 ["9539","Anders Nilsson","2026-11-03","PostNord","Ready to ship",[["629309311",1]]],
 ["9538","Sofia Berg","2026-11-02","DHL","Packing",[["629308811",1]]],
 ["9537","Johan Eriksson","2026-11-02","Bring","Open",[["99566",1],["99420",1]]],
 ["9536","Maja Svensson","2026-11-02","DHL","Picking",[["99488",3]]],
 ["9535","Erik Karlsson","2026-11-02","PostNord","Shipped",[["629308811",1]]],
 ["9534","Lina Andersson","2026-11-02","DHL","Open",[["629309311",1],["99566",1]]],
 ["9533","Oskar Persson","2026-11-01","Bring","Picking",[["99420",2]]],
 ["9532","Ella Johansson","2026-11-01","DHL","Ready to ship",[["99488",1],["99566",1]]],
 ["9531","Nils Larsson","2026-11-01","Collection","Open",[["629308811",1]]]
];
const KEY="zhister-wms-demo-v1";
let orders=JSON.parse(localStorage.getItem(KEY)||"null")||seed.map((r,i)=>({id:"ZH-"+(50879-i),number:r[0],customer:r[1],date:r[2],carrier:r[3],status:r[4],lines:r[5].map(x=>({sku:x[0],qty:x[1],picked:0})),weight:0,package:null}));
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
 const open=orders.filter(o=>o.status==="Open").length,pick=orders.filter(o=>o.status==="Picking").length,pack=orders.filter(o=>o.status==="Packing").length,ready=orders.filter(o=>o.status==="Ready to ship").length;
 $("#statOpen").textContent=open;$("#statPick").textContent=pick;$("#statShip").textContent=ready;$("#statPicked").textContent=orders.reduce((s,o)=>s+o.lines.reduce((a,l)=>a+l.picked,0),0);
 $("#flowOpen").textContent=open;$("#flowPicking").textContent=pick;$("#flowPacking").textContent=pack;$("#flowShip").textContent=ready;
 $("#recentRows").innerHTML=orders.slice(0,5).map(o=>`<tr><td><button class="order-link" data-order="${o.number}">#${o.number}</button><span class="sub-cell">${o.id}</span></td><td class="customer">${o.customer}</td><td>${o.date}</td><td>${o.lines.length} lines</td><td>${qty(o)} pcs</td><td>${o.carrier}</td><td>${badge(o.status)}</td><td>···</td></tr>`).join("");
 $("#orderNavCount").textContent=orders.length;
}
function renderOrders(){
 let q=$("#orderSearch").value.toLowerCase(),st=$("#statusFilter").value,car=$("#carrierFilter").value;
 let rows=orders.filter(o=>(!st||o.status===st)&&(!car||o.carrier===car)&&(!q||[o.id,o.number,o.customer,...o.lines.map(l=>l.sku)].join(" ").toLowerCase().includes(q)));
 $("#orderCount").textContent=rows.length;
 $("#orderRows").innerHTML=rows.map(o=>`<tr><td><button class="order-link" data-order="${o.number}">#${o.number}</button><span class="sub-cell">${o.id}</span></td><td class="customer">${o.customer}</td><td>${o.date}</td><td>${o.lines.length}</td><td>${qty(o)}</td><td>${o.carrier}</td><td>${badge(o.status)}</td><td><button class="text-btn" data-order="${o.number}">Details →</button></td></tr>`).join("")||`<tr><td colspan="8" class="muted">No matching orders.</td></tr>`;
 $$("[data-order]").forEach(b=>b.onclick=()=>showOrder(b.dataset.order));
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
function exportOrders(){csv("zhister-orders-demo.csv",[["Order ID","Order number","Customer","Date","Carrier","Status","Article","Product","Quantity","Picked"],...orders.flatMap(o=>o.lines.map(l=>[o.id,o.number,o.customer,o.date,o.carrier,o.status,l.sku,product(l.sku).name,l.qty,l.picked]))])}
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
 const lineRows=lines.length?lines.map(l=>({article:l.BuyersArticleNumber||l.SuppliersArticleNumber||l.ArticleID||"—",description:l.ArticleDescription||"—",qty:l.RequestedQuantity??l.DispatchedQuantity??l.ConfirmedQuantity??"—",status:l.DispatchLineStatus||"—"})):[];
 const eligibility=classifyShipment(s,dispatch,lines);
 return `<article class="live-shipment-card">
  <div class="live-shipment-head"><div><span class="eyebrow">ZHIPSTER SHIPMENT ${index+1}</span><h3>${safeText(s.ShipmentNumber||s.ShipmentKey||"Shipment")}</h3></div><span class="status-chip status-open">${safeText(shipmentStatus)}</span></div>
  <section class="eligibility-panel ${eligibility.kind}">
   <div class="eligibility-title"><strong>Warehouse eligibility</strong><span class="eligibility-chip">${safeText(eligibility.label)}</span></div>
   <p>${safeText(eligibility.reason)}</p>
   <small>Shipment status is informational only; it does not prove that this warehouse must pick the goods.</small>
  </section>
  <div class="live-shipment-grid">
   <div><small>Shipment ID</small><strong>${safeText(s.ShipmentKey||"—")}</strong></div>
   <div><small>Order reference</small><strong>${safeText(orderNo)}</strong></div>
   <div><small>Distribution model</small><strong>${safeText(distribution)}</strong></div>
   <div><small>Dispatch orders</small><strong>${dispatch.length}</strong></div>
  </div>
  ${lineRows.length?`<div class="table-wrap"><table><thead><tr><th>ARTICLE</th><th>DESCRIPTION</th><th>REQUESTED QTY</th><th>LINE STATUS</th></tr></thead><tbody>${lineRows.map(l=>`<tr><td><strong>${safeText(l.article)}</strong></td><td>${safeText(l.description)}</td><td>${safeText(l.qty)}</td><td>${safeText(l.status)}</td></tr>`).join("")}</tbody></table></div>`:`<p class="muted">No dispatch order lines were present in this response.</p>`}
  <p class="lookup-caution">Read-only classification preview. Live shipments are not imported into the demo queue, stock is not reserved, and no warehouse status is changed.</p>
 </article>`;
}
async function lookupZhipster(event){
 event.preventDefault();
 const type="orderNumber";
 const value=$("#zhipsterLookupValue").value.trim();
 const result=$("#zhipsterLookupResult"),button=$("#zhipsterLookupButton");
 if(!value){result.textContent="Enter an identifier first.";return}
 button.disabled=true;button.textContent="Searching…";result.textContent="Contacting Zhipster…";
 try{
  const params=new URLSearchParams({[type]:value});
  const response=await fetch(`/api/shipment?${params.toString()}`,{headers:{Accept:"application/json"},cache:"no-store"});
  const body=await response.json();
  if(!response.ok)throw new Error(body.error||`Lookup failed (HTTP ${response.status}).`);
  if(body.found===false){result.innerHTML='<p class="lookup-empty">No shipment was found for this identifier.</p>';return}
  const shipments=collectShipments(body.data);
  if(!shipments.length){result.innerHTML='<p class="lookup-empty">Zhipster returned data, but no shipment record could be identified in the response. The raw response is not shown.</p>';return}
  result.innerHTML=shipments.map(shipmentCard).join("");
 }catch(error){
  result.innerHTML=`<p class="lookup-error">${safeText(error.message||"Could not complete the lookup.")}</p>`;
 }finally{
  button.disabled=false;button.textContent="Search Zhipster";
 }
}
$("#zhipsterLookupForm").addEventListener("submit",lookupZhipster);

$("#orderSearch").oninput=renderOrders;$("#statusFilter").onchange=renderOrders;$("#carrierFilter").onchange=renderOrders;$("#clearFilters").onclick=()=>{$("#orderSearch").value="";$("#statusFilter").value="";$("#carrierFilter").value="";renderOrders()};
$("#pickSearch").oninput=renderPicking;$("#locationFilter").onchange=renderPicking;$("#pickStatus").onchange=renderPicking;$("#productSearch").oninput=renderProducts;$("#productLocation").onchange=renderProducts;
$("#exportOrders").onclick=exportOrders;$("#reportOrdersExport").onclick=exportOrders;$("#exportProducts").onclick=exportProducts;$("#reportProductsExport").onclick=exportProducts;
$("#printPick").onclick=()=>window.print();$("#printReport").onclick=()=>window.print();
function renderAll(){renderOverview();renderOrders();renderProducts();renderPicking();renderPacking();renderShipping();$("#reportOrders").textContent=orders.length}
renderAll();
