function weightedAveragePaise(receivedQuantity, receivedValuePaise) {
  const quantity=Number(receivedQuantity);
  const value=Number(receivedValuePaise);
  if(!Number.isFinite(quantity)||!Number.isFinite(value)||quantity<0||value<0) {
    throw new RangeError('Weighted-average inputs must be finite and non-negative.');
  }
  return quantity===0?0:value/quantity;
}

function variancePercent(planned,actual) {
  const expected=Number(planned),used=Number(actual);
  if(!Number.isFinite(expected)||!Number.isFinite(used)||expected<0||used<0) {
    throw new RangeError('Variance inputs must be finite and non-negative.');
  }
  return expected===0?0:((used-expected)/expected)*100;
}

function splitGst(gstPaise,sameState) {
  const gst=Number(gstPaise);
  if(!Number.isSafeInteger(gst)||gst<0) throw new RangeError('GST must be a non-negative integer number of paise.');
  if(!sameState) return {cgst:0,sgst:0,igst:gst};
  const cgst=Math.floor(gst/2);
  return {cgst,sgst:gst-cgst,igst:0};
}

function costPerPacket(materialCostPaise,labourPaise,overheadPaise,goodPackets) {
  const material=Number(materialCostPaise),labour=Number(labourPaise),overhead=Number(overheadPaise),output=Number(goodPackets);
  if(![material,labour,overhead,output].every(Number.isFinite)||material<0||labour<0||overhead<0||output<0) {
    throw new RangeError('Cost inputs must be finite and non-negative.');
  }
  return output===0?0:(material+labour+overhead)/output;
}

module.exports={weightedAveragePaise,variancePercent,splitGst,costPerPacket};
