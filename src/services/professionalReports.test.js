import { describe, it, expect } from 'vitest';
import ExcelJS from 'exceljs';
import { prepareReportExport, reportExportError, reportOrientation } from '../domain/reportExportModel';
import { writeExcel } from './reportExportWriters';
import { assetDefaults, tankerDistributions, RESET_TABLES } from '../domain/workflowSettings';
import { AomsEngine, INITIAL_AOMS_STATE } from '../domain/aomsEngine';
const columns=[{key:'log_date',label:'التاريخ'},{key:'asset_code',label:'رمز الأصل'},{key:'fuel_consumed',label:'الوقود'},{key:'notes',label:'الملاحظات'}];
const report={type:'operations',valid:true,filtersSummary:'أصل QA / 2026-10-01 — 2026-10-29',rows:[{id:'b',log_date:'2026-10-29',asset_code:'0002',fuel_consumed:0,notes:'=SUM(A1)'},{id:'a',log_date:'2026-10-01',asset_code:'0001',fuel_consumed:12,notes:'سري'},{id:'c',asset_code:'0003'}],summary:{fuel_consumed_by_unit:{'لتر':12,'جالون':3}}};
const prepare=(options={},r=report)=>prepareReportExport(r,columns,{generatedAt:'2026-10-29T12:00:00Z',...options});
describe('professional report contract',()=>{
 it('selection removes fields from rows, metadata metrics and file; preserves leading-zero code',async()=>{
  const r=prepare({columnKeys:['asset_code']});expect(r.rows.every(x=>Object.keys(x).join()==='asset_code')).toBe(true);expect(r.metrics).toHaveLength(1);
  const wb=await writeExcel(r,'اختبار');const copy=new ExcelJS.Workbook();await copy.xlsx.load(await wb.xlsx.writeBuffer());
  expect(copy.worksheets).toHaveLength(2);expect(copy.getWorksheet('التفاصيل').columnCount).toBe(1);expect(copy.getWorksheet('التفاصيل').getCell('A2').value).toBe('0002');expect(JSON.stringify(copy.model)).not.toContain('سري');
 });
 it('both date orders are stable, missing dates last, original snapshot unchanged',()=>{
  const before=JSON.stringify(report);expect(prepare().rows.map(r=>r.asset_code)).toEqual(['0002','0001','0003']);
  expect(prepare({newestFirst:false}).rows.map(r=>r.asset_code)).toEqual(['0001','0002','0003']);expect(JSON.stringify(report)).toBe(before);
 });
 it('rejects empty selection and incomplete source; a healthy source remains exportable',()=>{
  expect(()=>prepare({columnKeys:[]})).toThrow('اختر');expect(()=>prepare({}, {...report,exportError:'فشل التحميل'})).toThrow('فشل التحميل');
  expect(reportExportError({__snapshot:{failedTables:['operation_logs']}},'operations')).not.toBe('');expect(reportExportError({__snapshot:{failedTables:['audit_logs']}},'operations')).toBe('');
 });
 it('keeps mixed-unit totals separate and includes zero without treating it as missing',async()=>{
  const r=prepare();expect(r.metrics.filter(m=>m.label==='الوقود المستهلك').map(m=>m.unit)).toEqual(['لتر','جالون']);
  const wb=await writeExcel(r,'اختبار');const ws=wb.getWorksheet('التفاصيل');expect(ws.getCell('C2').value).toBe(0);expect(ws.getCell('C4').value).toBeNull();expect(ws.getCell('D2').formula).toBeUndefined();
  expect(ws.getCell('A2').value).toBeInstanceOf(Date);expect(ws.pageSetup.printTitlesRow).toBe('1:1');expect(ws.views[0].ySplit).toBe(1);expect(ws.pageSetup.paperSize).toBe(9);expect(ws.model.tables).toHaveLength(1);
 });
 it('duplicate visible labels are made unique without changing selected field identity',()=>{const r=prepareReportExport(report,[{key:'asset_code',label:'قيمة'},{key:'notes',label:'قيمة'}]);expect(r.columns.map(c=>c.label)).toEqual(['قيمة','قيمة (2)']);expect(r.columns.map(c=>c.key)).toEqual(['asset_code','notes']);});
 it('A4 chooses orientation by total width and accepts an explicit override',()=>{expect(reportOrientation([100,100])).toBe('portrait');expect(reportOrientation([300,300])).toBe('landscape');expect(reportOrientation([300,300],'portrait')).toBe('portrait');});
 it('empty filtered results produce a valid workbook with headers and zero summary',async()=>{const wb=await writeExcel(prepare({}, {...report,rows:[],summary:{}}),'فارغ');const copy=new ExcelJS.Workbook();await copy.xlsx.load(await wb.xlsx.writeBuffer());expect(copy.getWorksheet('التفاصيل').getCell('A1').value).toBe('التاريخ');expect(copy.getWorksheet('الملخص').getCell(5,2).value).toBe(0);});
 it('exports all 10001 rows rather than a UI page or PostgREST default cap',async()=>{
  const r=prepare({columnKeys:['asset_code','fuel_consumed']},{...report,rows:Array.from({length:10001},(_,i)=>({id:String(i),asset_code:`P-${i}`,fuel_consumed:i/10,log_date:'2026-10-29'}))});
  const wb=await writeExcel(r,'حجم كبير');expect(wb.getWorksheet('التفاصيل').rowCount).toBe(10002);expect(wb.getWorksheet('الملخص').getCell(5,2).value).toBe(10001);
 },30000);
});
describe('workflow defaults, distribution and reset',()=>{
 it('captures legacy effective rates once, independent of later category edits',()=>{const a=assetDefaults({}, {default_fuel_rate:12,default_chlorine_consumption:2,default_residual_chlorine:.4});expect(a.fuel_rate_override).toBe(12);expect(assetDefaults({}, {default_fuel_rate:99},a).fuel_rate_override).toBe(12);expect(()=>assetDefaults({fuel_rate_override:-1},{})).toThrow('غير سالبة');});
 it('truck view joins only its pump logs, without changing source records or totals',()=>{const logs=[{id:'1',tanker_id:'t',asset_id:'p',trips_count:2,distributed_quantity:6},{id:'2',tanker_id:'other',asset_id:'p',distributed_quantity:9}];const rows=tankerDistributions(logs,[{id:'p',name:'مضخة'}],'t');expect(rows).toHaveLength(1);expect(rows[0].pump.name).toBe('مضخة');expect(logs).toHaveLength(2);});
 it('used fuel unit is immutable in the local engine as well as the database',async()=>{const state=INITIAL_AOMS_STATE();state.fuel_types=[{id:'f',name:'سولار',unit:'لتر',version:1}];state.assets=[{id:'a',fuel_type_id:'f'}];const e=new AomsEngine(state,{id:'admin',role:'admin',status:'active'});await expect(e.saveFuelType({id:'f',name:'سولار',unit:'جالون',version:1})).rejects.toThrow('مقفلة');});
 it('reset denies non-admin, wrong phrase and stale preview; valid reset retains users/settings/audit',async()=>{
  const state=INITIAL_AOMS_STATE();state.assets=[{id:'a'}];state.operators=[{id:'o'}];state.profiles=[{id:'u',role:'admin',status:'active'}];state.app_settings=[{key:'business_timezone',value:'Asia/Jerusalem'}];
  const e=new AomsEngine(state,state.profiles[0]);const p=await e.previewReset();await expect(e.resetData('خطأ',p.fingerprint)).rejects.toThrow();e.state.operators.push({id:'new'});await expect(e.resetData('مسح شامل',p.fingerprint)).rejects.toThrow('تغيرت');const next=await e.previewReset();await e.resetData('مسح شامل',next.fingerprint);
  for(const t of RESET_TABLES.filter(t=>t!=='timeline_events'))expect(e.state[t]).toHaveLength(0);expect(e.state.profiles).toHaveLength(1);expect(e.state.app_settings).toHaveLength(1);expect(e.state.audit_logs.some(a=>a.action==='reset_application')).toBe(true);
  e.setUser({id:'v',role:'viewer',status:'active'});await expect(e.previewReset()).rejects.toThrow();
 });
});
