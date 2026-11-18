const root=document.getElementById('app');
const state={token:localStorage.getItem('ota_token'),user:null,data:null,tab:'overview',message:'',error:'',report:null,range:{from:'',to:''},orderLines:[]};

const esc=(x)=>String(x??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const n=(x)=>Number(x||0);
const money=(paise)=>new Intl.NumberFormat('en-IN',{style:'currency',currency:'INR',minimumFractionDigits:2}).format(n(paise)/100);
const quantity=(x)=>new Intl.NumberFormat('en-IN',{maximumFractionDigits:3}).format(n(x));
const date=(x)=>x?new Date(x).toLocaleString('en-IN',{dateStyle:'medium',timeStyle:'short'}):'—';
function unitChoices(unit,category){
  if(unit==='kg')return ['kg','g'];
  if(unit==='litre')return ['litre','ml'];
  if(category==='finished'&&unit==='packet')return ['packet','carton'];
  return [unit];
}
const api=async(path,options={})=>{
  const headers={...(options.body?{'Content-Type':'application/json'}:{}),...(state.token?{Authorization:`Bearer ${state.token}`}:{})};
  const response=await fetch(path,{...options,headers,body:options.body?JSON.stringify(options.body):undefined});
  const content=response.headers.get('content-type')||'';
  const data=content.includes('application/json')?await response.json():await response.text();
  if(!response.ok)throw new Error(data?.error||`Request failed (${response.status})`);
  return data;
};
const flash=(message,error=false)=>{state.message=error?'':message;state.error=error?message:'';};

function loginView(){
  root.innerHTML=`<main class="login-shell"><section class="login-card">
    <div class="brand-symbol">OA</div><p class="eyebrow">SMALL FOOD MANUFACTURING</p><h1>Order to Audit</h1>
    <p class="muted">One connected record from field order to factory floor to month-end report.</p>
    ${state.error?`<div class="alert error">${esc(state.error)}</div>`:''}
    <form id="login-form" class="stack">
      <label>Email<input name="email" type="email" value="admin@snacksaudit.test" autocomplete="username" required></label>
      <label>Password<input name="password" type="password" value="Admin@123" autocomplete="current-password" required></label>
      <button class="button primary wide">Sign in</button>
    </form>
    <details><summary>Demo accounts</summary><div class="demo-list">
      ${[['Salesman','salesman@snacksaudit.test','Salesman@123'],['Salesman B','salesmanb@snacksaudit.test','Salesman@123'],['Admin','admin@snacksaudit.test','Admin@123'],['Production','production@snacksaudit.test','Production@123'],['Auditor','auditor@snacksaudit.test','Auditor@123'],['Owner','owner@snacksaudit.test','Owner@123']].map(([label,email,password])=>`<button type="button" class="demo-account" data-email="${email}" data-password="${password}">${label}</button>`).join('')}
    </div></details>
  </section></main>`;
}

function roleTabs(){
  const tabs=[['overview','Overview']];
  if(['admin','production'].includes(state.user.role))tabs.push(['purchases','Purchases'],['production','Production']);
  if(['admin','salesman'].includes(state.user.role))tabs.push(['orders',state.user.role==='salesman'?'My orders':'Sales orders']);
  if(state.user.role==='admin')tabs.push(['invoices','Invoices']);
  if(['admin','auditor','owner'].includes(state.user.role))tabs.push(['stock','Stock ledger'],['reports','Audit reports']);
  return tabs;
}

function renderTable(headers,rows,empty='No records yet.'){
  if(!rows.length)return `<p class="empty">${esc(empty)}</p>`;
  return `<div class="table-wrap"><table><thead><tr>${headers.map(h=>`<th>${esc(h)}</th>`).join('')}</tr></thead><tbody>${rows.join('')}</tbody></table></div>`;
}

function overview(){
  const items=state.data.items||[];
  const alerts=items.filter(i=>i.reorder_level>0&&n(i.balance)<=n(i.reorder_level));
  const flagged=(state.data.runs||[]).filter(r=>r.flagged).length;
  return `${['admin','owner'].includes(state.user.role)?`<section class="metric-grid owner-metrics">
    <article class="metric"><span>Orders today</span><strong>${n(state.data.summary?.orders_today)}</strong><em>Submitted to factory</em></article>
    <article class="metric"><span>Customer outstanding</span><strong>${money(state.data.summary?.outstanding_paise)}</strong><em>Open posted invoices</em></article>
    <article class="metric"><span>Recent variance alerts</span><strong>${flagged}</strong><em>Production runs flagged</em></article>
  </section>`:''}
  <section class="metric-grid">
    ${items.map(i=>`<article class="metric"><span>${esc(i.name)}</span><strong>${quantity(i.balance)} <small>${esc(i.unit)}</small></strong><em>${esc(i.category)}</em></article>`).join('')}
  </section>
  ${alerts.length?`<div class="alert warning"><strong>Low stock:</strong> ${alerts.map(i=>esc(i.name)).join(', ')}</div>`:''}
  <div class="two-col">
    <section class="panel"><div class="panel-heading"><div><p class="eyebrow">PRODUCTION</p><h2>Recent runs</h2></div><span class="badge ${flagged?'warning':''}">${flagged} variance alerts</span></div>
      ${renderTable(['Run','Product','Output','Yield variance','Cost / packet','Margin / packet','Status'],(state.data.runs||[]).slice(0,5).map(r=>`<tr><td>${esc(r.number)}</td><td>${esc(r.product_name)}</td><td>${quantity(r.actual_output)}</td><td class="${r.flagged?'text-danger':''}">${n(r.yield_variance_pct).toFixed(1)}%</td><td>${money(r.cost_per_packet_paise)}</td><td>${money(n(r.sale_price_paise)-n(r.cost_per_packet_paise))}</td><td>${r.flagged?'Flagged':'On target'}</td></tr>`),'No production has been posted yet.')}</section>
    <section class="panel"><div class="panel-heading"><div><p class="eyebrow">ORDER FLOW</p><h2>Latest orders</h2></div></div>
      ${renderTable(['Order','Customer','Products','Status','Shortage'],(state.data.orders||[]).slice(0,6).map(o=>`<tr><td>${esc(o.number)}</td><td>${esc(o.customer_name)}</td><td>${esc(o.products)}</td><td><span class="status ${esc(o.status)}">${esc(o.status)}</span></td><td>${quantity(o.shortage)}</td></tr>`),'Orders from salesmen will appear here.')}</section>
  </div>`;
}

function purchaseView(){
  const materials=(state.data.items||[]).filter(i=>['raw','packaging'].includes(i.category));
  const first=materials[0];
  return `<section class="panel narrow-panel"><p class="eyebrow">INVENTORY RECEIPT</p><h2>Record a purchase</h2>
    <form id="purchase-form" class="form-grid">
      <label>Item<select name="itemId" required>${materials.map(i=>`<option value="${i.id}" data-unit="${esc(i.unit)}" data-category="${esc(i.category)}">${esc(i.name)} (${esc(i.unit)})</option>`).join('')}</select></label>
      <label>Supplier<input name="supplier" value="Benchmark Supplier" required></label>
      <label>Quantity<input name="quantity" type="number" step="0.001" min="0.001" value="60" required></label>
      <label>Entered unit<select name="unit">${unitChoices(first.unit,first.category).map(u=>`<option value="${u}" ${u===first.unit?'selected':''}>${u}</option>`).join('')}</select></label>
      <label>Cost per unit (₹)<input name="unitPrice" type="number" step="0.01" min="0" value="45" required></label>
      <button class="button primary">Post purchase and receive stock</button>
    </form><p class="hint">Enter unit prices in rupees. The ledger stores money in paise.</p>
  </section>`;
}

function productionView(){
  const products=(state.data.items||[]).filter(i=>i.category==='finished');
  const product=products[0];
  const lines=(state.data.bom||[]).filter(b=>b.product_id===product?.id);
  const defaultUsage={'FLOUR':40,'OIL':10.5,'SPICE':1.2,'POUCH-200':194,'CARTON':9};
  return `<section class="panel"><p class="eyebrow">BILL OF MATERIALS</p><h2>Post a production run</h2>
    ${product?`<form id="production-form" class="form-grid">
      <label>Product<select name="productId">${products.map(p=>`<option value="${p.id}">${esc(p.name)}</option>`).join('')}</select></label>
      <label>Batch quantity<input name="batchQuantity" type="number" min="0.001" step="0.001" value="1" required></label>
      ${lines.map(b=>`<label>${esc(b.name)} actual <span class="hint">Planned ${quantity(b.quantity)} ${esc(b.unit)} / batch</span><span class="unit-input"><input name="actual-${b.material_id}" type="number" min="0" step="0.001" value="${defaultUsage[b.code]??b.quantity}" required><select name="unit-${b.material_id}">${unitChoices(b.unit,b.category).map(u=>`<option value="${u}" ${u===b.unit?'selected':''}>${u}</option>`).join('')}</select></span></label>`).join('')}
      <label>Good packets produced<input name="actualOutput" type="number" min="0" step="1" value="188" required></label>
      <label>Damaged pouches<input name="damagedQuantity" type="number" min="0" step="1" value="6" required></label>
      <label>Labour total (₹)<input name="labour" type="number" min="0" step="0.01" value="1200"></label>
      <label>Gas / power total (₹)<input name="overhead" type="number" min="0" step="0.01" value="600"></label>
      <button class="button primary">Post run and update stock</button>
    </form><p class="hint">The 6 damaged pouches are included in actual pouch use (194 = 188 good packets + 6 damaged).</p>`:'<p class="empty">No finished product or BOM is configured.</p>'}
  </section>
  <section class="panel"><h2>Recent production and variance</h2>${renderTable(['Run','Product','Expected','Actual','Yield variance','Cost / packet','Margin / packet','Alert'],(state.data.runs||[]).map(r=>`<tr><td>${esc(r.number)}</td><td>${esc(r.product_name)}</td><td>${quantity(r.expected_output)}</td><td>${quantity(r.actual_output)}</td><td class="${r.flagged?'text-danger':''}">${n(r.yield_variance_pct).toFixed(1)}%</td><td>${money(r.cost_per_packet_paise)}</td><td>${money(n(r.sale_price_paise)-n(r.cost_per_packet_paise))}</td><td>${r.flagged?'⚠ Check variance':'—'}</td></tr>`))}</section>`;
}

function orderView(){
  const products=(state.data.items||[]).filter(i=>i.category==='finished');
  const isAdmin=state.user.role==='admin';
  return `<section class="panel"><p class="eyebrow">FIELD ORDER</p><h2>${isAdmin?'Enter an order':'Place a customer order'}</h2>
    <form id="order-form" class="form-grid">
      <label>Customer<select name="customerId" required>${(state.data.customers||[]).map(c=>`<option value="${c.id}">${esc(c.name)} · ${esc(c.state)}</option>`).join('')}</select></label>
      <div id="order-lines">${(state.orderLines.length?state.orderLines:[{}]).map(line=>orderLine(line,products)).join('')}</div>
      <button type="button" class="button secondary" data-action="add-line">+ Add product</button>
      <button class="button primary">Submit order</button>
    </form>
    ${!navigator.onLine?'<p class="alert warning">Offline: this order will be saved on this device and sent when you reconnect.</p>':''}
  </section>
  <section class="panel"><h2>${isAdmin?'Incoming orders':'My orders'}</h2>${ordersTable(isAdmin)}</section>`;
}
function orderLine(line,products){
  const product=products.find(p=>p.id===line.productId)||products[0];
  return `<div class="order-line"><label>Product<select name="productId" required>${products.map(p=>`<option value="${p.id}" ${product.id===p.id?'selected':''}>${esc(p.name)} · ${quantity(p.balance)} in stock · ${money(p.sale_price_paise)}/packet</option>`).join('')}</select></label><label>Quantity<input name="quantity" type="number" min="1" step="1" value="${esc(line.quantity||150)}" required></label><label>Unit<select name="unit">${unitChoices(product.unit,product.category).map(u=>`<option value="${u}" ${u===product.unit?'selected':''}>${u}${u==='carton'?' (20 packets)':''}</option>`).join('')}</select></label></div>`;
}
function ordersTable(isAdmin){
  const orders=state.data.orders||[];
  return renderTable(['Order','Customer','Salesman','Products','Stock shortage','Status',...(isAdmin?['Review']:[])],
    orders.map(o=>{
      const currentShortage=o.status==='submitted'?(o.order_lines||[]).reduce((total,line)=>{
        const item=state.data.items.find(i=>i.id===line.productId);
        return total+Math.max(0,n(line.quantity)-n(item?.balance));
      },0):0;
      const coverage=o.status!=='submitted'?'—':currentShortage>0?`Short ${quantity(currentShortage)}`:'Stock covers order';
      return `<tr><td>${esc(o.number)}<small class="subcell">${date(o.created_at)}</small></td><td>${esc(o.customer_name)}<small class="subcell">${esc(o.state||'')}</small></td><td>${esc(o.salesman_name||'You')}</td><td>${esc(o.products)}</td><td class="${o.status==='submitted'&&currentShortage>0?'text-danger':''}">${coverage}</td><td><span class="status ${esc(o.status)}">${esc(o.status)}</span></td>${isAdmin?`<td class="actions">${o.status==='submitted'?`<button class="button small secondary" data-action="edit-order" data-id="${o.id}">Edit</button><button class="button small primary" data-action="approve" data-id="${o.id}">Approve & invoice</button><button class="button small danger" data-action="reject" data-id="${o.id}">Reject</button>`:o.status==='invoiced'?'<span class="hint">Invoice ready</span>':''}</td>`:''}</tr>`;
    }),
    'No orders have been submitted.');
}

function invoicesView(){
  const invoices=state.data.invoices||[];
  return `<section class="panel"><p class="eyebrow">GST BILLING</p><h2>Posted invoices</h2>
    ${renderTable(['Invoice','Customer','Place of supply','Taxable','CGST + SGST','IGST','Total','Paid','Outstanding','Actions'],
      invoices.map(i=>{
        const total=n(i.total_paise),paid=n(i.paid_paise),due=total-paid;
        return `<tr><td>${esc(i.number)}<small class="subcell">${date(i.created_at)}</small></td><td>${esc(i.customer_name)}</td><td>${esc(i.place_of_supply)}</td><td>${money(i.taxable_paise)}</td><td>${money(n(i.cgst_paise)+n(i.sgst_paise))}</td><td>${money(i.igst_paise)}</td><td>${money(total)}</td><td>${money(paid)}</td><td>${money(due)}</td><td class="actions"><button class="button small secondary" data-action="pdf" data-id="${i.id}">Invoice PDF</button>${i.status==='posted'?`<button class="button small secondary" data-action="dispatch" data-id="${i.id}">Dispatch</button>${due?`<button class="button small primary" data-action="payment" data-id="${i.id}" data-due="${due}">Record payment</button>`:''}`:'Cancelled'}</td></tr>`;
      }),'Invoices created when orders are approved appear here.')}
  </section>`;
}

function stockView(){
  const stock=state.report?.stock||[];
  const ledger=state.report?.ledger||[];
  return `<section class="panel"><div class="panel-heading"><div><p class="eyebrow">LIVE BALANCES</p><h2>Stock summary</h2></div><button class="button secondary" data-action="load-stock">Refresh</button></div>
    ${renderTable(['Code','Item','Category','Balance','Unit','Reorder point'],stock.map(i=>`<tr><td>${esc(i.code)}</td><td>${esc(i.name)}</td><td>${esc(i.category)}</td><td class="${n(i.balance)<=n(i.reorder_level)?'text-danger':''}">${quantity(i.balance)}</td><td>${esc(i.unit)}</td><td>${quantity(i.reorder_level)}</td></tr>`),'Click refresh to load stock.')}</section>
    <section class="panel"><h2>Stock movement ledger</h2>${renderTable(['Time','Item','Movement','Quantity','Source','Reference','Note'],ledger.map(l=>`<tr><td>${date(l.created_at)}</td><td>${esc(l.name)}</td><td>${esc(l.movement_type)}</td><td>${quantity(l.quantity_delta)} ${esc(l.unit)}</td><td>${esc(l.source_type)}</td><td>${esc(l.source_id||'—')}</td><td>${esc(l.note)}</td></tr>`),'No stock movements in the selected date range.')}</section>`;
}

function reportView(){
  const r=state.report;
  return `<section class="panel"><p class="eyebrow">ACCOUNTANT / AUDITOR</p><h2>Audit reports</h2>
    <form id="report-filter" class="filter-row"><label>From<input type="date" name="from" value="${esc(state.range.from)}"></label><label>To<input type="date" name="to" value="${esc(state.range.to)}"></label><button class="button primary">Run reports</button></form>
    ${r?`<div class="report-downloads">${['sales','purchases','production','payments','ledger'].map(t=>`<button class="button secondary" data-download="${t}.csv">${t[0].toUpperCase()+t.slice(1)} CSV</button>`).join('')}</div>
      <h3>Sales register (${r.from} to ${r.to})</h3>${renderTable(['Invoice','Customer','State','Taxable','CGST','SGST','IGST','Date'],r.sales.map(i=>`<tr><td>${esc(i.number)}</td><td>${esc(i.customer_name)}</td><td>${esc(i.state)}</td><td>${money(i.taxable_paise)}</td><td>${money(i.cgst_paise)}</td><td>${money(i.sgst_paise)}</td><td>${money(i.igst_paise)}</td><td>${date(i.created_at)}</td></tr>`))}
      <h3>Customer-wise sales</h3>${renderTable(['Customer','Invoices','Taxable sales'],r.customerSales.map(c=>`<tr><td>${esc(c.name)}</td><td>${c.invoices}</td><td>${money(c.taxable_paise)}</td></tr>`))}
      <h3>Product-wise sales</h3>${renderTable(['Product','Packets sold','Taxable sales'],r.productSales.map(p=>`<tr><td>${esc(p.name)}</td><td>${quantity(p.quantity)}</td><td>${money(p.taxable_paise)}</td></tr>`))}
      <h3>GST outward supplies</h3>${renderTable(['State','Invoices','Taxable','CGST','SGST','IGST'],r.gst.map(g=>`<tr><td>${esc(g.state)}</td><td>${g.invoice_count}</td><td>${money(g.taxable_paise)}</td><td>${money(g.cgst_paise)}</td><td>${money(g.sgst_paise)}</td><td>${money(g.igst_paise)}</td></tr>`))}
      <h3>Purchase register</h3>${renderTable(['Purchase','Supplier','Item','Quantity','Unit cost','Date'],r.purchases.map(p=>`<tr><td>${esc(p.number)}</td><td>${esc(p.supplier)}</td><td>${esc(p.item_name)}</td><td>${quantity(p.quantity)} ${esc(p.unit)}</td><td>${money(p.unit_cost_paise)}</td><td>${date(p.created_at)}</td></tr>`))}
      <h3>Production variance and costing</h3>${renderTable(['Run','Product','Expected','Actual','Yield Δ','Flag','Cost / packet','Margin / packet'],r.production.map(p=>`<tr><td>${esc(p.number)}</td><td>${esc(p.product_name)}</td><td>${quantity(p.expected_output)}</td><td>${quantity(p.actual_output)}</td><td>${n(p.yield_variance_pct).toFixed(1)}%</td><td>${p.flagged?'⚠':'—'}</td><td>${money(p.cost_per_packet_paise)}</td><td>${money(n(p.sale_price_paise)-n(p.cost_per_packet_paise))}</td></tr>`))}
      <h3>Consumption variance</h3>${renderTable(['Run','Material','Planned','Actual','Variance'],r.consumption.map(c=>`<tr><td>${esc(c.run_number)}</td><td>${esc(c.item_name)}</td><td>${quantity(c.planned_quantity)} ${esc(c.unit)}</td><td>${quantity(c.actual_quantity)} ${esc(c.unit)}</td><td class="${Math.abs(n(c.variance_pct))>3?'text-danger':''}">${n(c.variance_pct).toFixed(1)}%</td></tr>`))}
      <h3>Collections</h3>${renderTable(['Date','Customer','Invoice','Received'],r.payments.map(p=>`<tr><td>${date(p.created_at)}</td><td>${esc(p.customer_name)}</td><td>${esc(p.invoice_number)}</td><td>${money(p.amount_paise)}</td></tr>`))}
      <h3>Receivables and ageing</h3>${renderTable(['Customer','Outstanding','0–30 days','31–60 days','Over 60 days'],r.outstanding.map(o=>`<tr><td>${esc(o.customer_name)}</td><td>${money(o.outstanding_paise)}</td><td>${money(o.age_0_30_paise)}</td><td>${money(o.age_31_60_paise)}</td><td>${money(o.age_over_60_paise)}</td></tr>`))}
    `:'<p class="empty">Choose a date range and run reports.</p>'}
  </section>`;
}

function render(){
  if(!state.token||!state.user){loginView();return;}
  const data=state.data;
  if(!data){root.innerHTML='<main class="loading-screen"><div class="spinner"></div><p>Loading your workspace…</p></main>';return;}
  const tabs=roleTabs();
  if(!tabs.some(t=>t[0]===state.tab))state.tab='overview';
  const page={overview, purchases:purchaseView, production:productionView, orders:orderView,
    invoices:invoicesView,stock:stockView,reports:reportView}[state.tab]||overview;
  root.innerHTML=`<header class="topbar"><a href="#" class="brand"><span class="brand-symbol">OA</span><span>OrdertoAudit<small>Factory operations</small></span></a>
    <div class="user-area"><span>${esc(state.user.name)}<small>${esc(state.user.role)}</small></span><button class="button quiet" data-action="logout">Sign out</button></div></header>
    <main class="main-shell"><div class="welcome"><div><p class="eyebrow">SNACK MANUFACTURING · TAMIL NADU</p><h1>${state.tab==='overview'?'Good day, '+esc(state.user.name.split(' ')[0]):esc(tabs.find(t=>t[0]===state.tab)?.[1])}</h1></div><div class="today">${new Date().toLocaleDateString('en-IN',{weekday:'long',day:'numeric',month:'long'})}</div></div>
    ${state.message?`<div class="alert success">${esc(state.message)}<button data-action="clear-message">×</button></div>`:''}
    ${state.error?`<div class="alert error">${esc(state.error)}<button data-action="clear-message">×</button></div>`:''}
    <nav class="tabs">${tabs.map(([key,label])=>`<button class="${state.tab===key?'active':''}" data-tab="${key}">${esc(label)}</button>`).join('')}</nav>
    <div class="page-content">${page()}</div></main><footer>OrdertoAudit · inventory balances are calculated from the stock ledger</footer>`;
}

async function loadData(){
  state.data=await api('/api/bootstrap');
  if(!state.user)state.user=state.data.user;
}
async function loadReports(){
  const p=new URLSearchParams();
  if(state.range.from)p.set('from',state.range.from);
  if(state.range.to)p.set('to',state.range.to);
  state.report=await api('/api/reports'+(p.size?'?'+p.toString():''));
}
async function loadLedger(){
  const p=new URLSearchParams();
  if(state.range.from)p.set('from',state.range.from);
  if(state.range.to)p.set('to',state.range.to);
  state.report=await api('/api/reports'+(p.size?'?'+p.toString():''));
}
async function refresh(){
  try{
    await loadData();
    if(['reports','stock'].includes(state.tab))await loadReports();
    flash('');
  }catch(error){
    if(error.message.includes('sign in again')){logout();return;}
    flash(error.message,true);
  }
  render();
}
function logout(){
  localStorage.removeItem('ota_token');
  state.token=null;state.user=null;state.data=null;state.report=null;
  render();
}
async function downloadFile(url,name){
  const response=await fetch(url,{headers:{Authorization:`Bearer ${state.token}`}});
  if(!response.ok){const d=await response.json().catch(()=>({}));throw new Error(d.error||'Download failed.');}
  const blob=await response.blob();
  const link=document.createElement('a');
  link.href=URL.createObjectURL(blob);link.download=name;link.click();
  setTimeout(()=>URL.revokeObjectURL(link.href),1000);
}

root.addEventListener('click',async(event)=>{
  const button=event.target.closest('button');
  if(!button)return;
  if(button.classList.contains('demo-account')){
    document.querySelector('#login-form [name=email]').value=button.dataset.email;
    document.querySelector('#login-form [name=password]').value=button.dataset.password;
    return;
  }
  if(button.dataset.tab){
    state.tab=button.dataset.tab;state.message='';state.error='';
    if(['reports','stock'].includes(state.tab)){try{await loadReports();}catch(e){flash(e.message,true);}}
    render();return;
  }
  const action=button.dataset.action;
  try{
    if(action==='logout'){logout();return;}
    if(action==='clear-message'){flash('');render();return;}
    if(action==='add-line'){
      const wrapper=document.getElementById('order-lines');
      const products=(state.data.items||[]).filter(i=>i.category==='finished');
      wrapper.insertAdjacentHTML('beforeend',orderLine({},products));return;
    }
    if(action==='approve'){
      await api(`/api/orders/${button.dataset.id}/approve`,{method:'POST'});
      flash('Order approved and GST invoice posted.');await refresh();return;
    }
    if(action==='reject'){
      await api(`/api/orders/${button.dataset.id}/reject`,{method:'POST'});
      flash('Order rejected.');await refresh();return;
    }
    if(action==='edit-order'){
      const order=(state.data.orders||[]).find(o=>o.id===button.dataset.id);
      if(!order)return;
      const lines=[];
      for(const line of order.order_lines||[]){
        const quantityValue=prompt(`Quantity for ${line.productName}`,line.quantity);
        if(quantityValue===null)return;
        const priceValue=prompt(`Selling price per packet for ${line.productName} (₹)`,(Number(line.unitPricePaise)/100).toFixed(2));
        if(priceValue===null)return;
        const quantity=Number(quantityValue),price=Number(priceValue);
        if(!Number.isFinite(quantity)||quantity<=0||!Number.isFinite(price)||price<0)throw new Error('Enter a valid positive quantity and non-negative price.');
        lines.push({productId:line.productId,quantity,unitPricePaise:Math.round(price*100)});
      }
      await api(`/api/orders/${order.id}/edit`,{method:'POST',body:{lines}});
      flash('Order quantities and prices updated.');await refresh();return;
    }
    if(action==='dispatch'){
      await api(`/api/invoices/${button.dataset.id}/dispatch`,{method:'POST'});
      flash('Dispatch posted; finished stock was reduced.');await refresh();return;
    }
    if(action==='payment'){
      const answer=prompt(`Enter payment amount in rupees. Outstanding: ₹${(Number(button.dataset.due)/100).toFixed(2)}`);
      if(answer===null)return;
      const amount=Number(answer);
      if(!Number.isFinite(amount)||amount<=0)throw new Error('Enter a positive rupee amount.');
      await api(`/api/invoices/${button.dataset.id}/payments`,{method:'POST',body:{amountPaise:Math.round(amount*100)}});
      flash('Payment recorded against the invoice.');await refresh();return;
    }
    if(action==='pdf'){
      const invoice=(state.data.invoices||[]).find(i=>i.id===button.dataset.id);
      await downloadFile(`/api/invoices/${button.dataset.id}.pdf`,`${(invoice?.number||'invoice').replaceAll('/','-')}.pdf`);return;
    }
    if(action==='load-stock'){await loadReports();render();return;}
    if(button.dataset.download){
      const type=button.dataset.download.replace('.csv','');
      const p=new URLSearchParams();
      if(state.range.from)p.set('from',state.range.from);
      if(state.range.to)p.set('to',state.range.to);
      await downloadFile(`/api/reports/${type}.csv${p.size?'?'+p.toString():''}`,`${type}.csv`);return;
    }
  }catch(error){flash(error.message,true);render();}
});

root.addEventListener('change',(event)=>{
  if(event.target.matches('#purchase-form [name=itemId]')){
    const option=event.target.selectedOptions[0];
    const unitSelect=document.querySelector('#purchase-form [name=unit]');
    const choices=unitChoices(option.dataset.unit,option.dataset.category);
    unitSelect.innerHTML=choices.map(u=>`<option value="${u}" ${u===option.dataset.unit?'selected':''}>${u}</option>`).join('');
  }
  if(event.target.matches('.order-line [name=productId]')){
    const product=state.data.items.find(i=>i.id===event.target.value);
    const unitSelect=event.target.closest('.order-line').querySelector('[name=unit]');
    unitSelect.innerHTML=unitChoices(product.unit,product.category).map(u=>`<option value="${u}" ${u===product.unit?'selected':''}>${u}${u==='carton'?' (20 packets)':''}</option>`).join('');
  }
});

root.addEventListener('submit',async(event)=>{
  event.preventDefault();
  const form=event.target;
  try{
    if(form.id==='login-form'){
      const f=new FormData(form);
      const result=await api('/api/auth/login',{method:'POST',body:{email:f.get('email'),password:f.get('password')}});
      state.token=result.token;state.user=result.user;localStorage.setItem('ota_token',result.token);
      state.tab='overview';state.error='';await refresh();return;
    }
    if(form.id==='purchase-form'){
      const f=new FormData(form);
      await api('/api/purchases',{method:'POST',body:{itemId:f.get('itemId'),supplier:f.get('supplier'),
        quantity:Number(f.get('quantity')),unit:f.get('unit'),unitCostPaise:Math.round(Number(f.get('unitPrice'))*100)}});
      state.tab='purchases';flash('Purchase saved and raw stock received.');await refresh();return;
    }
    if(form.id==='production-form'){
      const f=new FormData(form),actuals={};
      for(const [key,value] of f.entries())if(key.startsWith('actual-')){
        const id=key.slice(7);
        actuals[id]={quantity:Number(value),unit:f.get(`unit-${id}`)};
      }
      await api('/api/production-runs',{method:'POST',body:{productId:f.get('productId'),batchQuantity:Number(f.get('batchQuantity')),
        actuals,actualOutput:Number(f.get('actualOutput')),damagedQuantity:Number(f.get('damagedQuantity')),
        labourPaise:Math.round(Number(f.get('labour')||0)*100),overheadPaise:Math.round(Number(f.get('overhead')||0)*100)}});
      state.tab='production';flash('Production posted. Raw stock and finished goods updated automatically.');await refresh();return;
    }
    if(form.id==='order-form'){
      const f=new FormData(form),rows=[...form.querySelectorAll('.order-line')];
      const lines=rows.map(row=>({productId:row.querySelector('[name=productId]').value,quantity:Number(row.querySelector('[name=quantity]').value),unit:row.querySelector('[name=unit]').value}));
      const customerId=f.get('customerId');
      if(!navigator.onLine){
        const queue=JSON.parse(localStorage.getItem('ota_pending_orders')||'[]');
        queue.push({customerId,lines,queuedAt:new Date().toISOString()});
        localStorage.setItem('ota_pending_orders',JSON.stringify(queue));
        flash('Saved offline on this device. It will sync after connection returns.');render();return;
      }
      const result=await api('/api/orders',{method:'POST',body:{customerId,lines}});
      state.orderLines=[];state.tab='orders';
      flash(n(result.order.shortage)>0?`Order submitted; shortage flagged: ${quantity(result.order.shortage)} packets.`:'Order submitted to the factory.');
      await refresh();return;
    }
    if(form.id==='report-filter'){
      const f=new FormData(form);state.range={from:f.get('from'),to:f.get('to')};
      await loadReports();render();return;
    }
  }catch(error){flash(error.message,true);render();}
});

window.addEventListener('online',async()=>{
  if(!state.token)return;
  const queue=JSON.parse(localStorage.getItem('ota_pending_orders')||'[]');
  if(!queue.length)return;
  const pending=[];
  for(const order of queue){
    try{await api('/api/orders',{method:'POST',body:order});}
    catch(error){pending.push(order);flash(`Offline sync failed: ${error.message}`,true);}
  }
  localStorage.setItem('ota_pending_orders',JSON.stringify(pending));
  if(!pending.length)flash('Offline orders synced to the factory.');
  await refresh();
});
window.addEventListener('offline',()=>{if(state.user){flash('You are offline. Submitted orders will queue on this device.');render();}});

async function start(){
  if(!state.token){render();return;}
  try{await loadData();state.user=state.data.user;}catch{logout();return;}
  await refresh();
}
start();
