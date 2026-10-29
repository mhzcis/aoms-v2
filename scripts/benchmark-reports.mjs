// Reproducible isolated export load test. No application database or network data.
import fs from 'node:fs';
import assert from 'node:assert/strict';
import {createServer} from 'vite';
const server=await createServer({server:{middlewareMode:true},logLevel:'error'});
const out=process.env.QA_OUT||'/tmp/aoms-report-benchmark';fs.mkdirSync(out,{recursive:true});
try{
 const {prepareReportExport}=await server.ssrLoadModule('/src/domain/reportExportModel.js');
 const {writeExcel,writePDF}=await server.ssrLoadModule('/src/services/reportExportWriters.js');
 const fonts=Object.fromEntries([['amiriRegular','Regular'],['amiriBold','Bold']].map(([key,name])=>[key,fs.readFileSync(`public/fonts/Amiri-${name}.ttf`).toString('base64')]));
 const columns=[{key:'log_date',label:'التاريخ'},{key:'asset_code',label:'رمز الأصل'},{key:'asset_name',label:'اسم الأصل'},{key:'fuel_consumed',label:'الوقود'},{key:'fuel_consumed_unit',label:'وحدة الوقود'},{key:'dyn_pressure',label:'الضغط (bar)'},{key:'dyn_zone',label:'منطقة الأصل'},{key:'notes',label:'ملاحظات التشغيل'}];
 const results=[];
 for(const n of [1000,10000]){
  const report={type:'operations',valid:true,timeZone:'Asia/Jerusalem',filtersSummary:'أصول QA — من 2026-10-01 إلى 2026-10-29',summary:{fuel_consumed_by_unit:{'لتر':n*1.25}},dynamicColumns:[{field_key:'pressure',field_type:'number'},{field_key:'zone',field_type:'text'}],rows:Array.from({length:n},(_,i)=>({id:String(i),log_date:`2026-10-${String(i%29+1).padStart(2,'0')}`,asset_code:`QA-${String(i).padStart(5,'0')}`,asset_name:'مضخة QA',fuel_consumed:1.25,fuel_consumed_unit:'لتر',dyn_pressure:3.5,dyn_zone:'المنطقة الشرقية',notes:'قراءة معتمدة (QA-001) 2026'}))};
  const ready=prepareReportExport(report,columns,{generatedAt:'2026-10-29T12:00:00Z'});
  let start=performance.now();const wb=await writeExcel(ready,'تقرير إدارة الأصول');const xlsx=Buffer.from(await wb.xlsx.writeBuffer());assert.equal(wb.getWorksheet('التفاصيل').rowCount,n+1);
  const xlsxMs=Math.round(performance.now()-start);fs.writeFileSync(`${out}/${n}.xlsx`,xlsx);
  console.log(JSON.stringify({rows:n,format:'xlsx',ms:xlsxMs,bytes:xlsx.length}));
  start=performance.now();const pdf=await writePDF(ready,'تقرير إدارة الأصول',fonts);const bytes=Buffer.from(pdf.output('arraybuffer'));fs.writeFileSync(`${out}/${n}.pdf`,bytes);
  const result={rows:n,columns:columns.length,xlsxMs,pdfMs:Math.round(performance.now()-start),xlsxBytes:xlsx.length,pdfBytes:bytes.length,pdfPages:pdf.getNumberOfPages()};results.push(result);console.log(JSON.stringify(result));
 }
 const sample={type:'operations',rows:[{log_date:'2026-10-29',asset_code:'0001',notes:'نص عربي طويل '.repeat(150)}],summary:{},filtersSummary:'أصل واحد — يوم واحد'};
 const pdf=await writePDF(prepareReportExport(sample,[columns[0],columns[1],columns[7]],{orientation:'portrait'}),'تقرير عربي طولي',fonts);fs.writeFileSync(`${out}/portrait-long.pdf`,Buffer.from(pdf.output('arraybuffer')));
 fs.writeFileSync(`${out}/results.json`,JSON.stringify({runtime:process.version,results},null,2));
}finally{await server.close();}
