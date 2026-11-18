const express = require('express');
const crypto = require('node:crypto');
const { pool, transaction } = require('./db');
const { verifyPassword, sign, authenticate, allow } = require('./auth');
const { weightedAveragePaise, variancePercent, splitGst, costPerPacket } = require('./math');
const config=require('./config');
const {toBaseQuantity,toBaseUnitPricePaise}=require('./units');

const router = express.Router();
const asyncRoute = (fn) => (req,res,next) => Promise.resolve(fn(req,res,next)).catch(next);
const fail = (status,message,code) => Object.assign(new Error(message),{status,code});
const positive = (value,label,{zero=false}={}) => {
  const n=Number(value);
  if (!Number.isFinite(n) || (zero ? n<0 : n<=0)) throw fail(400,`${label} must be ${zero?'zero or greater':'greater than zero'}.`);
  return n;
};
const safeInteger = (value,label,{zero=false}={}) => {
  const n=Number(value);
  if (!Number.isSafeInteger(n) || (zero ? n<0 : n<=0)) throw fail(400,`${label} must be a valid amount in paise.`);
  return n;
};
const recordAudit = (client,userId,action,type,id,details={}) =>
  client.query('INSERT INTO audit_log(user_id,action,entity_type,entity_id,details) VALUES($1,$2,$3,$4,$5)',
    [userId,action,type,id,JSON.stringify(details)]);
const getBalance = async (client,itemId) => {
  const {rows}=await client.query('SELECT COALESCE(SUM(quantity_delta),0) AS balance FROM stock_ledger WHERE item_id=$1',[itemId]);
  return Number(rows[0].balance);
};
const getWeightedCost = async (client,itemId) => {
  const {rows}=await client.query(
    `SELECT COALESCE(SUM(quantity_delta * COALESCE(unit_cost_paise,0)) FILTER (WHERE quantity_delta>0),0) AS value,
            COALESCE(SUM(quantity_delta) FILTER (WHERE quantity_delta>0),0) AS quantity
       FROM stock_ledger WHERE item_id=$1`,[itemId]);
  const qty=Number(rows[0].quantity);
  return weightedAveragePaise(qty,Number(rows[0].value));
};
const docNumber=(prefix)=>`${prefix}-${new Date().toISOString().slice(0,10).replaceAll('-','')}-${crypto.randomBytes(3).toString('hex').toUpperCase()}`;
const stockLock=async(client,ids)=>{
  const unique=[...new Set(ids)].sort();
  if (unique.length) await client.query('SELECT id FROM items WHERE id=ANY($1::uuid[]) ORDER BY id FOR UPDATE',[unique]);
};

router.post('/auth/login',asyncRoute(async(req,res)=>{
  const email=String(req.body.email||'').trim().toLowerCase();
  const password=String(req.body.password||'');
  if (!email || !password) throw fail(400,'Enter your email and password.');
  const {rows}=await pool.query('SELECT id,email,name,role,password_hash FROM users WHERE lower(email)=$1',[email]);
  const user=rows[0];
  if (!user || !(await verifyPassword(password,user.password_hash))) throw fail(401,'Email or password is incorrect.');
  const token=sign(user.id,Date.now()+12*60*60*1000);
  res.json({token,user:{id:user.id,email:user.email,name:user.name,role:user.role}});
}));

router.use(authenticate);
router.get('/auth/me',(req,res)=>res.json({user:req.user}));

router.get('/bootstrap',asyncRoute(async(req,res)=>{
  const [items,customers,orders,runs,invoices,bom,summary]=await Promise.all([
    pool.query(`SELECT i.*,COALESCE(s.balance,0) balance FROM items i
      LEFT JOIN (SELECT item_id,SUM(quantity_delta) balance FROM stock_ledger GROUP BY item_id) s ON s.item_id=i.id
      ORDER BY CASE i.category WHEN 'finished' THEN 0 WHEN 'raw' THEN 1 ELSE 2 END,i.name`),
    pool.query('SELECT * FROM customers ORDER BY name'),
    pool.query(`SELECT o.*,c.name customer_name,c.state,u.name salesman_name,
       (SELECT string_agg(it.name||' × '||l.quantity,', ') FROM sales_order_lines l JOIN items it ON it.id=l.product_id WHERE l.order_id=o.id) products,
       (SELECT json_agg(json_build_object('productId',l.product_id,'productName',it.name,'quantity',l.quantity,
           'unitPricePaise',l.unit_price_paise) ORDER BY it.name)
        FROM sales_order_lines l JOIN items it ON it.id=l.product_id WHERE l.order_id=o.id) order_lines
       FROM sales_orders o JOIN customers c ON c.id=o.customer_id JOIN users u ON u.id=o.salesman_id
       ${req.user.role==='salesman'?'WHERE o.salesman_id=$1':''}
       ORDER BY o.created_at DESC LIMIT 100`,req.user.role==='salesman'?[req.user.id]:[]),
    pool.query(`SELECT r.*,i.name product_name,i.sale_price_paise FROM production_runs r JOIN items i ON i.id=r.product_id ORDER BY r.created_at DESC LIMIT 20`),
    ['admin','owner'].includes(req.user.role) ? pool.query(
      `SELECT v.*,c.name customer_name,c.gstin,
        v.taxable_paise+v.cgst_paise+v.sgst_paise+v.igst_paise total_paise,
        COALESCE(p.paid,0) paid_paise
       FROM invoices v JOIN customers c ON c.id=v.customer_id
       LEFT JOIN (SELECT invoice_id,SUM(amount_paise) paid FROM payments GROUP BY invoice_id) p ON p.invoice_id=v.id
       ORDER BY v.created_at DESC LIMIT 100`) : Promise.resolve({rows:[]}),
    pool.query(`SELECT b.product_id,b.material_id,b.quantity,i.name,i.code,i.unit,i.category
      FROM bom_lines b JOIN items i ON i.id=b.material_id ORDER BY i.name`),
    pool.query(`SELECT
      (SELECT COUNT(*)::int FROM sales_orders WHERE created_at::date=CURRENT_DATE) orders_today,
      COALESCE((SELECT SUM(v.taxable_paise+v.cgst_paise+v.sgst_paise+v.igst_paise-COALESCE(p.paid,0))
        FROM invoices v LEFT JOIN (SELECT invoice_id,SUM(amount_paise) paid FROM payments GROUP BY invoice_id) p ON p.invoice_id=v.id
        WHERE v.status='posted'),0) outstanding_paise`),
  ]);
  const visibleItems=req.user.role==='salesman'?items.rows.filter(item=>item.category==='finished'):items.rows;
  const visibleCustomers=['admin','salesman'].includes(req.user.role)?customers.rows:[];
  const visibleRuns=req.user.role==='salesman'?[]:runs.rows;
  const visibleBom=['admin','production'].includes(req.user.role)?bom.rows:[];
  res.json({user:req.user,items:visibleItems,customers:visibleCustomers,orders:orders.rows,runs:visibleRuns,
    invoices:invoices.rows,bom:visibleBom,summary:['admin','owner'].includes(req.user.role)?summary.rows[0]:null});
}));

router.post('/purchases',allow('admin','production'),asyncRoute(async(req,res)=>{
  const {itemId,supplier}=req.body;
  const enteredQuantity=positive(req.body.quantity,'Quantity');
  const enteredUnitCost=safeInteger(req.body.unitCostPaise,'Unit cost',{zero:true});
  const data=await transaction(async(client)=>{
    await stockLock(client,[itemId]);
    const item=await client.query("SELECT * FROM items WHERE id=$1 AND category IN ('raw','packaging')",[itemId]);
    if(!item.rows[0]) throw fail(404,'Raw material or packaging item not found.');
    const quantity=toBaseQuantity(enteredQuantity,req.body.unit,item.rows[0].unit,item.rows[0].category);
    if(quantity<=0) throw fail(400,'Quantity must be greater than zero.');
    const unitCost=toBaseUnitPricePaise(enteredUnitCost,req.body.unit,item.rows[0].unit,item.rows[0].category);
    const {rows:[purchase]}=await client.query(
      `INSERT INTO purchases(number,supplier,item_id,quantity,unit_cost_paise,created_by)
       VALUES($1,$2,$3,$4,$5,$6) RETURNING *`,
      [docNumber('PO'),String(supplier||'').trim()||'Supplier',itemId,quantity,unitCost,req.user.id]);
    await client.query(
      `INSERT INTO stock_ledger(item_id,quantity_delta,unit_cost_paise,movement_type,source_type,source_id,note,created_by)
       VALUES($1,$2,$3,'RECEIPT','PURCHASE',$4,$5,$6)`,
      [itemId,quantity,unitCost,purchase.id,`Purchase ${purchase.number}`,req.user.id]);
    await recordAudit(client,req.user.id,'created','purchase',purchase.id,{supplier,quantity,unitCostPaise:unitCost});
    return purchase;
  });
  res.status(201).json({purchase:data});
}));

router.post('/production-runs',allow('admin','production'),asyncRoute(async(req,res)=>{
  const productId=req.body.productId;
  const batches=positive(req.body.batchQuantity??1,'Batch quantity');
  const output=positive(req.body.actualOutput,'Good output',{zero:true});
  const damaged=positive(req.body.damagedQuantity??0,'Damaged quantity',{zero:true});
  const labour=safeInteger(req.body.labourPaise??0,'Labour',{zero:true});
  const overhead=safeInteger(req.body.overheadPaise??0,'Overheads',{zero:true});
  const actuals=req.body.actuals&&typeof req.body.actuals==='object'&&!Array.isArray(req.body.actuals)?req.body.actuals:{};
  const result=await transaction(async(client)=>{
    const {rows:[product]}=await client.query("SELECT * FROM items WHERE id=$1 AND category='finished'",[productId]);
    if(!product) throw fail(404,'Finished product not found.');
    const {rows:bom}=await client.query(
      `SELECT b.material_id,b.quantity,i.name,i.unit,i.category FROM bom_lines b JOIN items i ON i.id=b.material_id
       WHERE b.product_id=$1 ORDER BY b.material_id`,[productId]);
    if(!bom.length) throw fail(400,'No bill of materials is configured for this product.');
    await stockLock(client,bom.map(x=>x.material_id));
    const expected=Number(product.expected_yield)*batches;
    if(expected<=0) throw fail(400,'Expected yield must be configured for this product.');
    const runNumber=docNumber('PR');
    const {rows:[run]}=await client.query(
      `INSERT INTO production_runs(number,product_id,batch_quantity,expected_output,actual_output,damaged_quantity,labour_paise,overhead_paise,created_by)
       VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING *`,
      [runNumber,productId,batches,expected,output,damaged,labour,overhead,req.user.id]);
    let materialCost=0;
    let varianceFlag=false;
    for (const line of bom) {
      const planned=Number(line.quantity)*batches;
      const supplied=actuals[line.material_id]??planned;
      const actual=typeof supplied==='object'&&supplied!==null
        ?toBaseQuantity(positive(supplied.quantity,`${line.name} actual usage`,{zero:true}),supplied.unit,line.unit,line.category)
        :positive(supplied,`${line.name} actual usage`,{zero:true});
      const available=await getBalance(client,line.material_id);
      if(actual>available) throw fail(409,`Insufficient ${line.name}: ${actual} ${line.unit} required, ${available} ${line.unit} available.`,'INSUFFICIENT_STOCK');
      const unitCost=await getWeightedCost(client,line.material_id);
      materialCost+=Math.round(actual*unitCost);
      const variance=variancePercent(planned,actual);
      if(Math.abs(variance)>3) varianceFlag=true;
      await client.query(
        `INSERT INTO production_consumption(run_id,item_id,planned_quantity,actual_quantity,variance_pct) VALUES($1,$2,$3,$4,$5)`,
        [run.id,line.material_id,planned,actual,variance]);
      await client.query(
        `INSERT INTO stock_ledger(item_id,quantity_delta,unit_cost_paise,movement_type,source_type,source_id,note,created_by)
         VALUES($1,$2,$3,'ISSUE','PRODUCTION',$4,$5,$6)`,
        [line.material_id,-actual,unitCost,run.id,`${runNumber}: ${line.name}; planned ${planned}, actual ${actual}`,req.user.id]);
    }
    const yieldVariance=variancePercent(expected,output);
    if(Math.abs(yieldVariance)>3) varianceFlag=true;
    const totalCost=materialCost+labour+overhead;
    const costPer=costPerPacket(materialCost,labour,overhead,output);
    await client.query(
      `INSERT INTO stock_ledger(item_id,quantity_delta,movement_type,source_type,source_id,note,created_by)
       VALUES($1,$2,'RECEIPT','PRODUCTION',$3,$4,$5)`,
      [productId,output,run.id,`${runNumber}: ${output} good packets; ${damaged} damaged`,req.user.id]);
    const {rows:[saved]}=await client.query(
      `UPDATE production_runs SET material_cost_paise=$1,total_cost_paise=$2,cost_per_packet_paise=$3,yield_variance_pct=$4,flagged=$5
       WHERE id=$6 RETURNING *`,[materialCost,totalCost,costPer,yieldVariance,varianceFlag,run.id]);
    await recordAudit(client,req.user.id,'posted','production_run',run.id,{runNumber,actualOutput:output,damaged,labourPaise:labour,overheadPaise:overhead});
    return saved;
  });
  res.status(201).json({run:result});
}));

router.post('/orders',allow('salesman','admin'),asyncRoute(async(req,res)=>{
  const customerId=req.body.customerId;
  const lines=Array.isArray(req.body.lines)?req.body.lines:[];
  if(!lines.length) throw fail(400,'Add at least one product to the order.');
  const order=await transaction(async(client)=>{
    const customer=await client.query('SELECT id FROM customers WHERE id=$1',[customerId]);
    if(!customer.rows[0]) throw fail(404,'Customer not found.');
    const productIds=[...new Set(lines.map(l=>l.productId))];
    const products=await client.query("SELECT * FROM items WHERE id=ANY($1::uuid[]) AND category='finished'",[productIds]);
    if(products.rows.length!==productIds.length) throw fail(400,'One or more selected products are invalid.');
    const productById=new Map(products.rows.map(p=>[p.id,p]));
    const combined=new Map();
    for(const line of lines){
      const product=productById.get(line.productId);
      const entered=positive(line.quantity,'Order quantity');
      const qty=toBaseQuantity(entered,line.unit,product.unit,product.category);
      combined.set(line.productId,(combined.get(line.productId)||0)+qty);
    }
    let shortage=0;
    const {rows:[created]}=await client.query(
      `INSERT INTO sales_orders(number,customer_id,salesman_id,status) VALUES($1,$2,$3,'submitted') RETURNING *`,
      [docNumber('SO'),customerId,req.user.id]);
    for(const p of products.rows){
      const qty=combined.get(p.id);
      const balance=await getBalance(client,p.id);
      shortage+=Math.max(0,qty-balance);
      await client.query('INSERT INTO sales_order_lines(order_id,product_id,quantity,unit_price_paise) VALUES($1,$2,$3,$4)',
        [created.id,p.id,qty,p.sale_price_paise]);
    }
    await client.query('UPDATE sales_orders SET shortage=$1 WHERE id=$2',[shortage,created.id]);
    await recordAudit(client,req.user.id,'submitted','sales_order',created.id,{shortage});
    return {...created,shortage};
  });
  res.status(201).json({order});
}));

router.post('/orders/:id/edit',allow('admin'),asyncRoute(async(req,res)=>{
  const order=await transaction(async(client)=>{
    const {rows:[current]}=await client.query('SELECT * FROM sales_orders WHERE id=$1 FOR UPDATE',[req.params.id]);
    if(!current) throw fail(404,'Order not found.');
    if(current.status!=='submitted') throw fail(409,'Only submitted orders can be edited.');
    const lines=Array.isArray(req.body.lines)?req.body.lines:[];
    if(!lines.length) throw fail(400,'At least one order line is required.');
    await stockLock(client,lines.map(line=>line.productId));
    await client.query('DELETE FROM sales_order_lines WHERE order_id=$1',[current.id]);
    let shortage=0;
    for(const line of lines){
      const entered=positive(line.quantity,'Quantity');
      const price=safeInteger(line.unitPricePaise,'Price',{zero:true});
      const {rows:[product]}=await client.query("SELECT id,unit,category FROM items WHERE id=$1 AND category='finished'",[line.productId]);
      if(!product) throw fail(404,'Finished product not found.');
      const quantity=toBaseQuantity(entered,line.unit,product.unit,product.category);
      shortage+=Math.max(0,quantity-(await getBalance(client,line.productId)));
      await client.query('INSERT INTO sales_order_lines(order_id,product_id,quantity,unit_price_paise) VALUES($1,$2,$3,$4)',
        [current.id,line.productId,quantity,price]);
    }
    const {rows:[saved]}=await client.query('UPDATE sales_orders SET shortage=$1,updated_at=now() WHERE id=$2 RETURNING *',[shortage,current.id]);
    await recordAudit(client,req.user.id,'edited','sales_order',saved.id,{shortage});
    return saved;
  });
  res.json({order});
}));

router.post('/orders/:id/reject',allow('admin'),asyncRoute(async(req,res)=>{
  await transaction(async(client)=>{
    const {rows}=await client.query(
      `UPDATE sales_orders SET status='rejected',updated_at=now() WHERE id=$1 AND status='submitted' RETURNING id`,
      [req.params.id]);
    if(!rows[0]) throw fail(409,'Order not found or is no longer awaiting review.');
    await recordAudit(client,req.user.id,'rejected','sales_order',rows[0].id,{});
  });
  res.json({success:true});
}));

router.post('/orders/:id/approve',allow('admin'),asyncRoute(async(req,res)=>{
  const result=await transaction(async(client)=>{
    const {rows:[order]}=await client.query(
      `SELECT o.*,c.state,c.gstin FROM sales_orders o JOIN customers c ON c.id=o.customer_id WHERE o.id=$1 FOR UPDATE`,[req.params.id]);
    if(!order) throw fail(404,'Order not found.');
    if(order.status!=='submitted') throw fail(409,'Order is not awaiting approval.');
    const {rows:lines}=await client.query(
      `SELECT l.*,i.name,i.gst_rate,i.hsn FROM sales_order_lines l JOIN items i ON i.id=l.product_id WHERE l.order_id=$1 ORDER BY i.name`,
      [order.id]);
    await stockLock(client,lines.map(l=>l.product_id));
    let shortage=0;
    let taxable=0;
    let totalGst=0;
    for(const line of lines){
      const balance=await getBalance(client,line.product_id);
      shortage+=Math.max(0,Number(line.quantity)-balance);
      const lineTaxable=Math.round(Number(line.quantity)*line.unit_price_paise);
      taxable+=lineTaxable;
      totalGst+=Math.round(lineTaxable*Number(line.gst_rate)/100);
    }
    if(shortage>0){
      await client.query('UPDATE sales_orders SET shortage=$1 WHERE id=$2',[shortage,order.id]);
      return {shortage};
    }
    const fyDate=new Date();
    const startYear=fyDate.getMonth()>=3?fyDate.getFullYear():fyDate.getFullYear()-1;
    const fy=`${startYear}-${String(startYear+1).slice(-2)}`;
    const {rows:[counter]}=await client.query(
      `INSERT INTO invoice_counters(financial_year,last_number) VALUES($1,1)
       ON CONFLICT(financial_year) DO UPDATE SET last_number=invoice_counters.last_number+1
       RETURNING last_number`,[fy]);
    const number=`INV/${fy}/${String(counter.last_number).padStart(4,'0')}`;
    const local=order.state===config.factoryState;
    const {cgst,sgst,igst}=splitGst(totalGst,local);
    const {rows:[created]}=await client.query(
      `INSERT INTO invoices(number,order_id,customer_id,place_of_supply,taxable_paise,cgst_paise,sgst_paise,igst_paise,created_by)
       VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING *`,
      [number,order.id,order.customer_id,order.state,taxable,cgst,sgst,igst,req.user.id]);
    for(const line of lines){
      const lineTaxable=Math.round(Number(line.quantity)*line.unit_price_paise);
      const lineGst=Math.round(lineTaxable*Number(line.gst_rate)/100);
      await client.query(
        `INSERT INTO invoice_lines(invoice_id,product_id,quantity,unit_price_paise,taxable_paise,gst_paise)
         VALUES($1,$2,$3,$4,$5,$6)`,
        [created.id,line.product_id,line.quantity,line.unit_price_paise,lineTaxable,lineGst]);
    }
    await client.query("UPDATE sales_orders SET status='invoiced',shortage=0,updated_at=now() WHERE id=$1",[order.id]);
    await recordAudit(client,req.user.id,'posted','invoice',created.id,{number,orderId:order.id});
    return {invoice:created};
  });
  if(result.shortage>0) return res.status(409).json({
    error:`Insufficient finished goods: shortage of ${result.shortage} packets. Make or dispatch available stock first.`,
    code:'INSUFFICIENT_STOCK'
  });
  res.status(201).json({invoice:result.invoice});
}));

router.post('/invoices/:id/dispatch',allow('admin'),asyncRoute(async(req,res)=>{
  const result=await transaction(async(client)=>{
    const {rows:[invoice]}=await client.query('SELECT * FROM invoices WHERE id=$1 FOR UPDATE',[req.params.id]);
    if(!invoice||invoice.status!=='posted') throw fail(404,'Posted invoice not found.');
    const {rows:order}=await client.query('SELECT status FROM sales_orders WHERE id=$1 FOR UPDATE',[invoice.order_id]);
    if(order[0].status==='dispatched') throw fail(409,'This invoice has already been dispatched.');
    const {rows:lines}=await client.query('SELECT * FROM invoice_lines WHERE invoice_id=$1',[invoice.id]);
    await stockLock(client,lines.map(l=>l.product_id));
    for(const line of lines){
      const balance=await getBalance(client,line.product_id);
      if(Number(line.quantity)>balance) throw fail(409,'Not enough finished-goods stock to dispatch this invoice.','INSUFFICIENT_STOCK');
    }
    for(const line of lines){
      await client.query(
        `INSERT INTO stock_ledger(item_id,quantity_delta,movement_type,source_type,source_id,note,created_by)
         VALUES($1,$2,'ISSUE','INVOICE',$3,$4,$5)`,
        [line.product_id,-Number(line.quantity),invoice.id,`Dispatch ${invoice.number}`,req.user.id]);
    }
    await client.query("UPDATE sales_orders SET status='dispatched',updated_at=now() WHERE id=$1",[invoice.order_id]);
    await recordAudit(client,req.user.id,'dispatched','invoice',invoice.id,{number:invoice.number});
    return {success:true};
  });
  res.json(result);
}));

router.post('/invoices/:id/payments',allow('admin'),asyncRoute(async(req,res)=>{
  const amount=safeInteger(req.body.amountPaise,'Payment amount');
  const result=await transaction(async(client)=>{
    const {rows:[invoice]}=await client.query('SELECT * FROM invoices WHERE id=$1 AND status=\'posted\' FOR UPDATE',[req.params.id]);
    if(!invoice) throw fail(404,'Posted invoice not found.');
    const {rows:[paid]}=await client.query('SELECT COALESCE(SUM(amount_paise),0) amount FROM payments WHERE invoice_id=$1',[invoice.id]);
    const total=invoice.taxable_paise+invoice.cgst_paise+invoice.sgst_paise+invoice.igst_paise;
    const outstanding=total-Number(paid.amount);
    if(amount>outstanding) throw fail(409,`Payment is greater than the outstanding ₹${(outstanding/100).toFixed(2)}.`,'OVERPAYMENT');
    const {rows:[payment]}=await client.query(
      'INSERT INTO payments(invoice_id,amount_paise,note,received_by) VALUES($1,$2,$3,$4) RETURNING *',
      [invoice.id,amount,String(req.body.note||''),req.user.id]);
    await recordAudit(client,req.user.id,'received','payment',payment.id,{invoiceId:invoice.id,amountPaise:amount});
    return {payment,outstandingPaise:outstanding-amount};
  });
  res.status(201).json(result);
}));

router.get('/stock-ledger',allow('admin','production','auditor','owner'),asyncRoute(async(req,res)=>{
  const {rows}=await pool.query(
    `SELECT l.*,i.code,i.name,i.category,i.unit FROM stock_ledger l JOIN items i ON i.id=l.item_id
     WHERE ($1::uuid IS NULL OR l.item_id=$1) ORDER BY l.created_at DESC,l.id DESC LIMIT 1000`,
    [req.query.itemId||null]);
  res.json({ledger:rows});
}));

router.get('/reports',allow('admin','auditor','owner'),asyncRoute(async(req,res)=>{
  const from=req.query.from||new Date(new Date().getFullYear(),new Date().getMonth(),1).toISOString().slice(0,10);
  const to=req.query.to||new Date().toISOString().slice(0,10);
  const params=[from,to];
  const [sales,purchases,production,consumption,stock,ledger,payments,outstanding,gst,products,customerSales]=await Promise.all([
    pool.query(`SELECT v.*,c.name customer_name,c.state,c.gstin,o.number order_number FROM invoices v
      JOIN customers c ON c.id=v.customer_id JOIN sales_orders o ON o.id=v.order_id
      WHERE v.created_at >= $1::date AND v.created_at < $2::date+interval '1 day' ORDER BY v.created_at`,params),
    pool.query(`SELECT p.*,i.name item_name,i.unit FROM purchases p JOIN items i ON i.id=p.item_id
      WHERE p.created_at >= $1::date AND p.created_at < $2::date+interval '1 day' ORDER BY p.created_at`,params),
    pool.query(`SELECT r.*,i.name product_name,i.sale_price_paise FROM production_runs r JOIN items i ON i.id=r.product_id
      WHERE r.created_at >= $1::date AND r.created_at < $2::date+interval '1 day' ORDER BY r.created_at`,params),
    pool.query(`SELECT c.*,i.name item_name,i.unit,r.number run_number FROM production_consumption c
      JOIN items i ON i.id=c.item_id JOIN production_runs r ON r.id=c.run_id
      WHERE r.created_at >= $1::date AND r.created_at < $2::date+interval '1 day' ORDER BY r.created_at`,params),
    pool.query(`SELECT i.code,i.name,i.category,i.unit,COALESCE(SUM(l.quantity_delta),0) balance,i.reorder_level
      FROM items i LEFT JOIN stock_ledger l ON l.item_id=i.id GROUP BY i.id ORDER BY i.category,i.name`),
    pool.query(`SELECT l.*,i.name item_name,i.unit FROM stock_ledger l JOIN items i ON i.id=l.item_id
      WHERE l.created_at >= $1::date AND l.created_at < $2::date+interval '1 day' ORDER BY l.created_at,l.id`,params),
    pool.query(`SELECT p.*,v.number invoice_number,c.name customer_name FROM payments p
      JOIN invoices v ON v.id=p.invoice_id JOIN customers c ON c.id=v.customer_id
      WHERE p.created_at >= $1::date AND p.created_at < $2::date+interval '1 day' ORDER BY p.created_at`,params),
    pool.query(`WITH inv AS (SELECT v.id,v.customer_id,v.created_at,v.taxable_paise+v.cgst_paise+v.sgst_paise+v.igst_paise total
        FROM invoices v WHERE v.status='posted'),
      paid AS (SELECT invoice_id,SUM(amount_paise) amount FROM payments GROUP BY invoice_id),
      due AS (SELECT inv.*,inv.total-COALESCE(paid.amount,0) balance FROM inv LEFT JOIN paid ON paid.invoice_id=inv.id)
      SELECT c.id customer_id,c.name customer_name,
       SUM(due.balance) outstanding_paise,
       SUM(CASE WHEN current_date-due.created_at::date<=30 THEN due.balance ELSE 0 END) age_0_30_paise,
       SUM(CASE WHEN current_date-due.created_at::date BETWEEN 31 AND 60 THEN due.balance ELSE 0 END) age_31_60_paise,
       SUM(CASE WHEN current_date-due.created_at::date>60 THEN due.balance ELSE 0 END) age_over_60_paise
      FROM due JOIN customers c ON c.id=due.customer_id WHERE due.balance>0 GROUP BY c.id,c.name ORDER BY c.name`),
    pool.query(`SELECT c.state,v.place_of_supply,COUNT(*)::int invoice_count,SUM(v.taxable_paise) taxable_paise,
      SUM(v.cgst_paise) cgst_paise,SUM(v.sgst_paise) sgst_paise,SUM(v.igst_paise) igst_paise
      FROM invoices v JOIN customers c ON c.id=v.customer_id
      WHERE v.status='posted' AND v.created_at >= $1::date AND v.created_at < $2::date+interval '1 day'
      GROUP BY c.state,v.place_of_supply ORDER BY c.state`,params),
    pool.query(`SELECT i.name,SUM(l.quantity) quantity,SUM(l.taxable_paise) taxable_paise
      FROM invoice_lines l JOIN invoices v ON v.id=l.invoice_id JOIN items i ON i.id=l.product_id
      WHERE v.status='posted' AND v.created_at >= $1::date AND v.created_at < $2::date+interval '1 day'
      GROUP BY i.name ORDER BY i.name`,params),
    pool.query(`SELECT c.name,SUM(v.taxable_paise) taxable_paise,COUNT(*)::int invoices
      FROM invoices v JOIN customers c ON c.id=v.customer_id WHERE v.status='posted'
      AND v.created_at >= $1::date AND v.created_at < $2::date+interval '1 day'
      GROUP BY c.name ORDER BY c.name`,params),
  ]);
  res.json({from,to,sales:sales.rows,purchases:purchases.rows,production:production.rows,consumption:consumption.rows,
    stock:stock.rows,ledger:ledger.rows,payments:payments.rows,outstanding:outstanding.rows,gst:gst.rows,
    productSales:products.rows,customerSales:customerSales.rows});
}));

function csvCell(value) {
  const text=String(value??'');
  return `"${text.replaceAll('"','""')}"`;
}
router.get('/reports/:type.csv',allow('admin','auditor','owner'),asyncRoute(async(req,res)=>{
  const from=req.query.from||new Date(new Date().getFullYear(),new Date().getMonth(),1).toISOString().slice(0,10);
  const to=req.query.to||new Date().toISOString().slice(0,10);
  const params=[from,to];
  const queries={
    sales:`SELECT v.number,c.name customer,c.state,v.taxable_paise,v.cgst_paise,v.sgst_paise,v.igst_paise,v.created_at
      FROM invoices v JOIN customers c ON c.id=v.customer_id WHERE v.created_at >= $1::date AND v.created_at < $2::date+interval '1 day'`,
    purchases:`SELECT p.number,p.supplier,i.name item,p.quantity,i.unit,p.unit_cost_paise,p.created_at FROM purchases p JOIN items i ON i.id=p.item_id
      WHERE p.created_at >= $1::date AND p.created_at < $2::date+interval '1 day'`,
    stock:`SELECT i.code,i.name,i.category,i.unit,COALESCE(SUM(l.quantity_delta),0) balance FROM items i LEFT JOIN stock_ledger l ON l.item_id=i.id GROUP BY i.id`,
    production:`SELECT r.number,i.name product,r.expected_output,r.actual_output,r.damaged_quantity,r.yield_variance_pct,r.flagged,r.cost_per_packet_paise
      FROM production_runs r JOIN items i ON i.id=r.product_id WHERE r.created_at >= $1::date AND r.created_at < $2::date+interval '1 day'`,
    payments:`SELECT v.number invoice,c.name customer,p.amount_paise,p.note,p.created_at FROM payments p JOIN invoices v ON v.id=p.invoice_id JOIN customers c ON c.id=v.customer_id
      WHERE p.created_at >= $1::date AND p.created_at < $2::date+interval '1 day'`,
    ledger:`SELECT i.code,i.name,l.movement_type,l.source_type,l.source_id,l.quantity_delta,i.unit,l.note,l.created_at
      FROM stock_ledger l JOIN items i ON i.id=l.item_id WHERE l.created_at >= $1::date AND l.created_at < $2::date+interval '1 day'`,
  };
  const sql=queries[req.params.type];
  if(!sql) throw fail(404,'Unknown report type.');
  const result=await pool.query(sql,params);
  const {rows}=result;
  const fields=result.fields.map(field=>field.name);
  const text=[fields.map(csvCell).join(','),...rows.map(row=>fields.map(k=>csvCell(row[k])).join(','))].join('\r\n');
  res.set('Content-Type','text/csv; charset=utf-8');
  res.set('Content-Disposition',`attachment; filename="${req.params.type}-${from}-to-${to}.csv"`);
  res.send(text);
}));

function pdfEscape(value) {
  return String(value).replace(/[\\()]/g,'\\$&').replace(/[^\x20-\x7e]/g,'?');
}
function makePdf(lines) {
  const commands=['BT','/F1 11 Tf','48 750 Td','14 TL'];
  for(const [index,line] of lines.entries()) {
    if(index) commands.push('T*');
    commands.push(`(${pdfEscape(line).slice(0,105)}) Tj`);
  }
  commands.push('ET');
  const stream=commands.join('\n');
  const objects=[
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>',
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
    `<< /Length ${Buffer.byteLength(stream)} >>\nstream\n${stream}\nendstream`,
  ];
  let doc='%PDF-1.4\n';
  const offsets=[0];
  objects.forEach((obj,i)=>{offsets.push(Buffer.byteLength(doc));doc+=`${i+1} 0 obj\n${obj}\nendobj\n`;});
  const xref=Buffer.byteLength(doc);
  doc+=`xref\n0 ${objects.length+1}\n0000000000 65535 f \n`;
  for(let i=1;i<offsets.length;i++) doc+=`${String(offsets[i]).padStart(10,'0')} 00000 n \n`;
  doc+=`trailer\n<< /Size ${objects.length+1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF`;
  return Buffer.from(doc,'ascii');
}

router.get('/invoices/:id.pdf',allow('admin','auditor','owner'),asyncRoute(async(req,res)=>{
  const {rows:[invoice]}=await pool.query(
    `SELECT v.*,c.name customer,c.gstin,c.state FROM invoices v JOIN customers c ON c.id=v.customer_id WHERE v.id=$1`,[req.params.id]);
  if(!invoice) throw fail(404,'Invoice not found.');
  const {rows:lines}=await pool.query(
    `SELECT l.*,i.name,i.hsn,i.gst_rate FROM invoice_lines l JOIN items i ON i.id=l.product_id WHERE l.invoice_id=$1`,[invoice.id]);
  const text=[
    'TAX INVOICE - ORDERTOAUDIT',
    `Supplier: Demo Snack Foods    State: ${config.factoryState}    GSTIN: ${config.factoryGstin}`,
    `Invoice: ${invoice.number}    Date: ${new Date(invoice.created_at).toLocaleDateString('en-IN')}`,
    `Customer: ${invoice.customer}`,
    `GSTIN: ${invoice.gstin||'Not provided'}    Place of supply: ${invoice.place_of_supply}`,
    'Description / HSN / Quantity / Rate / Taxable (INR) / GST (INR)',
    ...lines.map(l=>`${l.name} / ${l.hsn} / ${l.quantity} / ${l.gst_rate}% / ${(l.taxable_paise/100).toFixed(2)} / ${(l.gst_paise/100).toFixed(2)}`),
    `Taxable value: Rs ${(invoice.taxable_paise/100).toFixed(2)}`,
    `CGST: Rs ${(invoice.cgst_paise/100).toFixed(2)}  SGST: Rs ${(invoice.sgst_paise/100).toFixed(2)}  IGST: Rs ${(invoice.igst_paise/100).toFixed(2)}`,
    `Invoice total: Rs ${((invoice.taxable_paise+invoice.cgst_paise+invoice.sgst_paise+invoice.igst_paise)/100).toFixed(2)}`,
    `Status: ${invoice.status.toUpperCase()}`,
  ];
  res.type('application/pdf').set('Content-Disposition',`attachment; filename="${invoice.number.replaceAll('/','-')}.pdf"`).send(makePdf(text));
}));

module.exports=router;
