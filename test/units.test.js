const test=require('node:test');
const assert=require('node:assert/strict');
const {toBaseQuantity,toBaseUnitPricePaise}=require('../server/src/units');

test('weight and volume quantities convert into the item base unit',()=>{
  assert.equal(toBaseQuantity(1250,'g','kg','raw'),1.25);
  assert.equal(toBaseQuantity(750,'ml','litre','raw'),0.75);
});

test('cartons of finished packets convert using the 20-packet carton size',()=>{
  assert.equal(toBaseQuantity(3,'cartons','packet','finished'),60);
});

test('one packaging carton item remains one piece in packaging stock',()=>{
  assert.equal(toBaseQuantity(4,'carton','piece','packaging'),4);
});

test('unit rates are converted to match the inventory base unit',()=>{
  assert.equal(toBaseUnitPricePaise(5,'g','kg','raw'),5000);
  assert.equal(toBaseUnitPricePaise(5000,'carton','packet','finished'),250);
});

test('incompatible units return a client error',()=>{
  assert.throws(()=>toBaseQuantity(1,'litre','kg','raw'),{status:400});
});
