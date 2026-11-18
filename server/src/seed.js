const { pool, transaction } = require('./db');
const { hashPassword } = require('./auth');

const users = [
  ['salesman@snacksaudit.test', 'Salesman A', 'salesman', 'Salesman@123'],
  ['salesmanb@snacksaudit.test', 'Salesman B', 'salesman', 'Salesman@123'],
  ['admin@snacksaudit.test', 'Factory Admin', 'admin', 'Admin@123'],
  ['production@snacksaudit.test', 'Production Supervisor', 'production', 'Production@123'],
  ['auditor@snacksaudit.test', 'External Auditor', 'auditor', 'Auditor@123'],
  ['owner@snacksaudit.test', 'Factory Owner', 'owner', 'Owner@123'],
];

async function seed() {
  await transaction(async (client) => {
    for (const [email, name, role, password] of users) {
      await client.query(
        `INSERT INTO users(email,name,role,password_hash) VALUES($1,$2,$3,$4)
         ON CONFLICT(email) DO NOTHING`,
        [email, name, role, await hashPassword(password)]
      );
    }

    const count = await client.query('SELECT count(*)::int AS n FROM items');
    if (count.rows[0].n) return;

    const definitions = [
      ['FLOUR','Flour','raw','kg','110100',0,4200,100,0,20],
      ['OIL','Cooking oil','raw','litre','150790',0,14000,30,0,5],
      ['SPICE','Salt and spice mix','raw','kg','091091',0,20000,5,0,1],
      ['POUCH-200','200 g pouch','packaging','piece','392329',0,250,500,0,100],
      ['CARTON','Carton (holds 20 packets)','packaging','piece','481910',0,1500,30,0,5],
      ['MURUKKU-200','Murukku 200 g','finished','packet','190590',5000,0,50,200,20],
    ];
    const itemIds = {};
    for (const [code,name,category,unit,hsn,salePrice,openingCost,openingQty,yieldQty,reorderLevel] of definitions) {
      const { rows } = await client.query(
        `INSERT INTO items(code,name,category,unit,hsn,sale_price_paise,opening_cost_paise,expected_yield,reorder_level)
         VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING id`,
        [code,name,category,unit,hsn,salePrice,openingCost,yieldQty,reorderLevel]
      );
      const itemId=rows[0].id;
      itemIds[code]=itemId;
      await client.query(
        `INSERT INTO stock_ledger(item_id,quantity_delta,unit_cost_paise,movement_type,source_type,note)
         VALUES($1,$2,$3,'OPENING','OPENING_BALANCE','Benchmark opening stock')`,
        [itemId,openingQty,openingCost]
      );
    }
    for (const [code,qty] of [['FLOUR',40],['OIL',10],['SPICE',1.2],['POUCH-200',200],['CARTON',10]]) {
      await client.query('INSERT INTO bom_lines(product_id,material_id,quantity) VALUES($1,$2,$3)',
        [itemIds['MURUKKU-200'],itemIds[code],qty]);
    }
    await client.query(
      `INSERT INTO customers(name,state,gstin,customer_type) VALUES
       ('Retailer A','Tamil Nadu','33AAAAA0000A1Z5','retailer'),
       ('Distributor B','Karnataka','29BBBBB0000B1Z5','distributor')
       ON CONFLICT(name) DO NOTHING`
    );
  });
  console.log('Benchmark data and role accounts are ready:');
  for (const [email,,role,password] of users) console.log(`  ${role}: ${email} / ${password}`);
}

if (require.main === module) {
  seed().then(() => pool.end()).catch(async (error) => {
    console.error(error);
    await pool.end();
    process.exitCode = 1;
  });
}

module.exports = { seed };
