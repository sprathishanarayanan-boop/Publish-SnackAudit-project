const test=require('node:test');
const assert=require('node:assert/strict');
const {weightedAveragePaise,variancePercent,splitGst,costPerPacket}=require('../server/src/math');

test('benchmark weighted average flour cost preserves sub-paise precision',()=>{
  assert.equal(weightedAveragePaise(160,100*4200+60*4500),4312.5);
});

test('benchmark production variance flags the 6 percent yield and 5 percent oil overuse',()=>{
  assert.equal(variancePercent(200,188),-6);
  assert.equal(variancePercent(10,10.5),5);
});

test('benchmark GST divides local supply and applies IGST to interstate supply',()=>{
  assert.deepEqual(splitGst(37500,true),{cgst:18750,sgst:18750,igst:0});
  assert.deepEqual(splitGst(37500,false),{cgst:0,sgst:0,igst:37500});
});

test('benchmark cost per packet includes materials and direct run overhead',()=>{
  assert.equal(costPerPacket(405500,120000,60000,188),3114.3617021276596);
});
