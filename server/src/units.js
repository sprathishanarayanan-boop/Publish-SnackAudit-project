const aliases={grams:'g',gram:'g',kilograms:'kg',kilogram:'kg',liters:'litre',litres:'litre',
  liter:'litre',milliliters:'ml',millilitres:'ml',milliliter:'ml',millilitre:'ml',
  pieces:'piece',packets:'packet',cartons:'carton'};

function normalize(unit){
  const value=String(unit||'').trim().toLowerCase();
  return aliases[value]||value;
}

function toBaseQuantity(quantity,fromUnit,baseUnit,category){
  const amount=Number(quantity);
  if(!Number.isFinite(amount)||amount<0) throw Object.assign(new Error('Quantity must be a non-negative number.'),{status:400});
  const from=normalize(fromUnit||baseUnit),base=normalize(baseUnit);
  if(from===base)return amount;
  const mass={g:0.001,kg:1};
  const volume={ml:0.001,litre:1};
  if(mass[from]!==undefined&&mass[base]!==undefined)return amount*mass[from]/mass[base];
  if(volume[from]!==undefined&&volume[base]!==undefined)return amount*volume[from]/volume[base];
  if(category==='finished'&&base==='packet'&&from==='carton')return amount*20;
  if(['packet','piece'].includes(from)&&['packet','piece'].includes(base))return amount;
  if(category==='packaging'&&base==='piece'&&from==='carton')return amount;
  throw Object.assign(new Error(`Cannot convert ${from} to ${base} for this item.`),{status:400});
}

function acceptedUnits(baseUnit,category){
  const base=normalize(baseUnit);
  if(base==='kg')return ['kg','g'];
  if(base==='litre')return ['litre','ml'];
  if(category==='finished'&&base==='packet')return ['packet','carton'];
  if(base==='piece')return ['piece'];
  return [base];
}

function toBaseUnitPricePaise(unitCostPaise,fromUnit,baseUnit,category){
  const cost=Number(unitCostPaise);
  if(!Number.isSafeInteger(cost)||cost<0) throw Object.assign(new Error('Unit cost must be a non-negative integer number of paise.'),{status:400});
  const baseQuantity=toBaseQuantity(1,fromUnit,baseUnit,category);
  return Math.round(cost/baseQuantity);
}

module.exports={toBaseQuantity,acceptedUnits,toBaseUnitPricePaise};
