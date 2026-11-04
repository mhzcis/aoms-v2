import {describe,it,expect} from 'vitest';
import ExcelJS from 'exceljs';
import JSZip from 'jszip';
import {buildAomsReport} from '../domain/aomsEngine';
import {getAomsReportColumns} from './aomsReportService';
import {prepareReportExport} from '../domain/reportExportModel';
import {reportCell,reportTotals} from '../domain/reportTableModel';
import {writeExcel} from './reportExportWriters';
const base={type:'operations',valid:true,filtersSummary:'التصنيف: مضخات — من 2026-10-01 إلى 2026-10-31',rows:[{id:'a',log_date:'2026-10-29',asset_code:'P-0001',previous_reading:100,current_reading:108,net_operation_delta:8,meter_unit_snapshot:'ساعة تشغيل',fuel_consumed:96,fuel_consumed_unit:'لتر',water_total:560,trips_count:8,distributed_quantity:96,network_quantity:464,chlorine_consumed:2,chlorine_consumed_unit:'كجم',residual_chlorine:.05}],summary:{count:1}};
const cols=r=>getAomsReportColumns(r.type,r.dynamicColumns,r);
const ready=(r=base,options={})=>prepareReportExport(r,cols(r),{generatedAt:'2026-11-01T10:00:00Z',...options});
describe('November report presentation',()=>{
 it('places units in measurement headings, with no independent unit column',()=>{
  const c=cols(base);expect(c.map(x=>x.label)).toEqual(expect.arrayContaining(['صافي التشغيل (ساعة)','الوقود المستهلك (لتر)','الكلور المستهلك (كجم)','عدد النقلات (نقلة)']));expect(c.some(x=>['meter_unit_snapshot','fuel_consumed_unit','chlorine_consumed_unit','unit_snapshot'].includes(x.key))).toBe(false);
 });
 it('splits mixed units into numeric columns without conversions or lost values',()=>{
  const r={...base,rows:[...base.rows,{...base.rows[0],id:'b',meter_unit_snapshot:'كيلومتر',net_operation_delta:11,fuel_consumed:3,fuel_consumed_unit:'جالون',chlorine_consumed:4,chlorine_consumed_unit:'لتر'}]};
  const p=ready(r),fuel=p.columns.filter(c=>c.sourceKey==='fuel_consumed');expect(fuel.map(x=>x.label)).toEqual(['الوقود المستهلك (لتر)','الوقود المستهلك (جالون)']);expect(p.rows[0][fuel[0].key]).toBe(96);expect(p.rows[0][fuel[1].key]).toBeNull();expect(p.rows[1][fuel[1].key]).toBe(3);expect(p.totals[fuel[0].key]).toBe(96);expect(p.totals[fuel[1].key]).toBe(3);
 });
 it('selecting one unit excludes every value and total for the other unit',()=>{
  const r={...base,rows:[...base.rows,{id:'b',fuel_consumed:777,fuel_consumed_unit:'جالون'}]};const c=cols(r).find(x=>x.label==='الوقود المستهلك (لتر)');const p=ready(r,{columnKeys:[c.key]});expect(p.columns).toHaveLength(1);expect(p.rows.map(x=>x[c.key])).toEqual([96,null]);expect(JSON.stringify(p.metrics)).not.toContain('777');expect(p.metrics.some(m=>m.unit==='جالون')).toBe(false);
 });
 it('normalizes equivalent units and sums additive measures only',()=>{
  const r={...base,rows:[...base.rows,{...base.rows[0],id:'b',meter_unit_snapshot:'ساعة',net_operation_delta:0,chlorine_consumed_unit:'كغم'}]};const c=cols(r),t=reportTotals(r,c);expect(c.filter(x=>x.sourceKey==='net_operation_delta')).toHaveLength(1);expect(t.net_operation_delta).toBe(8);expect(t.fuel_consumed).toBe(192);expect(t.trips_count).toBe(16);for(const k of ['previous_reading','current_reading','residual_chlorine'])expect(t).not.toHaveProperty(k);
 });
 it('preserves zeros and missing data and does not guess unknown units',()=>{const r={...base,rows:[{id:'x',fuel_consumed:0},{id:'y',fuel_consumed:null}]};const c=cols(r).find(c=>c.sourceKey==='fuel_consumed');expect(c.label).toContain('(غير محددة)');expect(reportCell(r.rows[0],c)).toBe(0);expect(reportTotals(r,[c])).not.toHaveProperty(c.key);});
 it('fuel and chlorine transaction headings carry units; unlike movement types are not summed',()=>{
  for(const type of ['fuel','chlorine']){const r={type,rows:[{quantity:10,unit_snapshot:'لتر',transaction_type:'supply'},{quantity:2,unit_snapshot:'لتر',transaction_type:'adjustment_minus'}]};const c=cols(r);expect(c.find(x=>x.sourceKey==='quantity').label).toBe('الكمية (لتر)');expect(reportTotals(r,c)).not.toHaveProperty('quantity');r.rows.pop();expect(reportTotals(r,cols(r)).quantity).toBe(10);}
 });
 it('native XLSX styles stop at the table, center every cell, and include cached SUBTOTALs',async()=>{
  const p=ready(),wb=await writeExcel(p,'تقرير المضخات');const copy=new ExcelJS.Workbook();const bytes=await wb.xlsx.writeBuffer();await copy.xlsx.load(bytes);const ws=copy.getWorksheet('التفاصيل'),n=p.columns.length,last=ws.getRow(3);
  expect(ws.rowCount).toBe(3);expect(last.getCell(1).value).toBe('الإجمالي');const fuel=p.columns.findIndex(c=>c.key==='fuel_consumed')+1;expect(last.getCell(fuel).value).toEqual({formula:`SUBTOTAL(109,${ws.getColumn(fuel).letter}2:${ws.getColumn(fuel).letter}2)`,result:96});
  for(let row=1;row<=3;row++)for(let col=1;col<=n;col++){const cell=ws.getCell(row,col);expect(cell.font.name).toBe('Noto Naskh Arabic');expect(cell.alignment.horizontal).toBe('center');expect(cell.alignment.vertical).toBe('middle');}
  expect(ws.getRow(1).fill).toBeUndefined();expect(ws.getCell(1,n+1).fill).toBeUndefined();expect(last.getCell(n).fill.fgColor.argb).toBe('FF006F9E');expect(ws.pageSetup.printArea).toContain('3');
  const zip=await JSZip.loadAsync(bytes),xml=await zip.file('xl/worksheets/sheet2.xml').async('string');expect(xml).not.toMatch(/<row[^>]*\ss="/);expect(xml).not.toContain('customFormat=');expect(xml).not.toContain('16384');
  const summary=copy.getWorksheet('الملخص');expect(summary.columnCount).toBe(2);expect(summary.getCell('C1').fill).toBeUndefined();
 });
 it('a numeric-only single-column export keeps its actual total and no extra column',async()=>{const p=ready(base,{columnKeys:['fuel_consumed']});const wb=await writeExcel(p,'وقود'),ws=wb.getWorksheet('التفاصيل');expect(ws.columnCount).toBe(1);expect(ws.getCell('A3').value.result).toBe(96);expect(ws.getCell('A3').numFmt).toContain('الإجمالي');});
 it('asset rate headers derive fuel and chlorine units from report metadata',()=>{
  const state={categories:[{id:'c',name:'مضخات',uses_meter:true,meter_unit:'ساعة تشغيل',supports_fuel:true,supports_chlorine:true,chlorine_unit:'كجم'}],assets:[{id:'a',category_id:'c',fuel_type_id:'f',has_fuel_rate_override:true,fuel_rate_override:12,has_chlorine_consumption_override:true,chlorine_consumption_override:2}],fuel_types:[{id:'f',name:'سولار',unit:'لتر'}]};
  const r=buildAomsReport(state,{scope:'all_assets',type:'assets'}),c=cols(r);expect(c.find(x=>x.sourceKey==='effective_fuel_rate').label).toBe('معدل الوقود الفعال (لتر/ساعة)');expect(c.find(x=>x.sourceKey==='effective_chlorine').label).toBe('معدل الكلور الفعال (كجم)');
 });
 it('dynamic fields retain identity, units, values and no arbitrary aggregation',()=>{const r={...base,dynamicColumns:[{field_key:'pressure',label:'الضغط',field_type:'number',unit:'bar'}],rows:[{...base.rows[0],dyn_pressure:3.5}]};const p=ready(r);expect(p.columns.find(c=>c.key==='dyn_pressure').label).toBe('الضغط (bar)');expect(p.rows[0].dyn_pressure).toBe(3.5);expect(p.totals).not.toHaveProperty('dyn_pressure');});
});
