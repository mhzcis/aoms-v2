// Presentation-only report model: calculations and stored operation records stay intact.
const UNIT_COLUMNS=new Set(['meter_unit_snapshot','fuel_consumed_unit','chlorine_consumed_unit','unit_snapshot']);
const UNIT_FIELDS={previous_reading:'meter_unit_snapshot',current_reading:'meter_unit_snapshot',net_operation_delta:'meter_unit_snapshot',fuel_consumed:'fuel_consumed_unit',chlorine_consumed:'chlorine_consumed_unit',quantity:'unit_snapshot',effective_fuel_rate:'fuel_rate_unit',effective_chlorine:'chlorine_consumed_unit'};
const SUMMARY_UNITS={net_operation_delta:'net_operation_by_unit',fuel_consumed:'fuel_consumed_by_unit',chlorine_consumed:'chlorine_consumed_by_unit'};
const FIXED_UNITS={water_total:'م³',distributed_quantity:'م³',network_quantity:'م³',trips_count:'نقلة',pump_capacity:'م³/ساعة'};
const ADDITIVE=new Set(['net_operation_delta','fuel_consumed','chlorine_consumed','water_total','trips_count','distributed_quantity','network_quantity']);
export const TOTALS_NOTE='تُجمع المقاييس المتجانسة فقط؛ قراءات العدادات وتركيز الكلور والمعدلات لا تُجمع. كميات الحركات المختلفة مفصلة في الملخص.';
export function reportUnit(value){
 const unit=String(value??'').trim();
 return ({'ساعة تشغيل':'ساعة','ساعات':'ساعة','كغم':'كجم','كيلوغرام':'كجم','متر مكعب':'م³','متر مكعّب':'م³'})[unit]||unit||'غير محددة';
}
const present=v=>v!==null&&v!==undefined&&v!==''&&v!=='—';
export function reportTableColumns(report,columns){
 const rows=report.rows||[];
 return columns.filter(c=>!UNIT_COLUMNS.has(c.key)).flatMap(c=>{
  if(c.unitResolved)return [c];
  const field=UNIT_FIELDS[c.key];
  if(!field){const unit=FIXED_UNITS[c.key];return [{...c,unitResolved:true,sourceKey:c.key,...(unit?{unit,label:c.label.includes(`(${unit})`)?c.label:`${c.label} (${unit})`}:{})}];}
  let units=[...new Set(rows.filter(r=>present(r[c.key])).map(r=>reportUnit(r[field])))];
  if(!units.length)units=[...new Set(rows.map(r=>r[field]).filter(Boolean).map(reportUnit))];
  if(!units.length)units=Object.keys(report.summary?.[SUMMARY_UNITS[c.key]]||{}).map(reportUnit);
  units=[...new Set(units)];if(!units.length)units=['غير محددة'];
  return units.map(unit=>({...c,sourceKey:c.key,key:units.length===1?c.key:`${c.key}__unit_${encodeURIComponent(unit)}`,unitField:field,unit,unitResolved:true,label:`${c.label} (${unit})`}));
 });
}
export function reportCell(row,column){
 const key=column.sourceKey||column.key;
 if(Object.hasOwn(row,column.key)&&column.key!==key)return row[column.key];
 if(column.unitField&&reportUnit(row[column.unitField])!==column.unit)return null;
 return row[key];
}
export function reportTotals(report,columns,rows=report.rows||[],projected=false){
 const totals={};
 for(const c of columns){
  const source=c.sourceKey||c.key;
  const values=rows.map(r=>projected?r[c.key]:reportCell(r,c)).filter(present);
  if(!values.length)continue;
  const quantityRows=source==='quantity'?(report.rows||[]).filter(r=>present(reportCell(r,c))):[];
  const movements=new Set(quantityRows.map(r=>`${r.event_type||report.type}|${r.transaction_type||r.transaction_type_label||''}`));
  const eligible=ADDITIVE.has(source)||(source==='quantity'&&movements.size===1);
  if(!eligible||c.unit==='غير محددة'||values.some(v=>!Number.isFinite(Number(v))))continue;
  // Match the stored decimal precision without accumulating binary float drift.
  totals[c.key]=Math.round(values.reduce((s,v)=>s+Number(v),0)*1e6)/1e6;
 }
 return totals;
}
export function reportTotalLabelKey(columns,totals){return (columns.find(c=>!Object.hasOwn(totals,c.key))||columns[0])?.key;}
