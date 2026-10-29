import bidiFactory from 'bidi-js';
import { businessDateTime } from '../utils/businessTime';
import { loadAmiriFonts } from '../assets/fonts/amiriFontData';
import { reportOrientation } from '../domain/reportExportModel';

const TEAL='FF115E59', INK='FF0F172A', SOFT='FFF0FDFA';
export const PDF_RTL_TEXT_OPTIONS={isInputVisual:false,isInputRtl:true,isOutputVisual:true,isOutputRtl:false,isSymmetricSwapping:true};
const filename=(r,ext)=>`AOMS-${r.type}-${r.generatedAt.replace(/[:.]/g,'-')}.${ext}`;
const save=(blob,name)=>{if(typeof document==='undefined'||typeof URL?.createObjectURL!=='function')return;const url=URL.createObjectURL(blob);const a=document.createElement('a');a.href=url;a.download=name;document.body.appendChild(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(url),1000);};
function excelValue(c,value){
  if(value==null||value==='')return null;
  if(c.type==='number')return Number.isFinite(Number(value))?Number(value):null;
  if(c.type==='date'&&/^\d{4}-\d{2}-\d{2}$/.test(String(value)))return new Date(`${value}T00:00:00Z`);
  if(c.type==='boolean')return Boolean(value);
  return String(value);
}

export async function writeExcel(report,title){
  if(report.rows.length>100000)throw new Error('حد Excel هو 100000 سجل؛ قلص فترة التقرير');
  const {default:ExcelJS}=await import('exceljs');
  const wb=new ExcelJS.Workbook();wb.creator='AOMS';wb.created=new Date(report.generatedAt);wb.title=title;
  const overview=wb.addWorksheet('الملخص',{views:[{rightToLeft:true}],pageSetup:{paperSize:9,orientation:'portrait',fitToPage:true,fitToWidth:1,fitToHeight:0}});
  overview.columns=[{width:32},{width:65},{width:18}];
  const metadata=[['التقرير',title],['الفلاتر',report.filtersSummary],['الترتيب',report.sortLabel],['وقت التصدير',`${businessDateTime(report.generatedAt,report.timeZone)} (${report.timeZone||'Asia/Jerusalem'})`],['عدد السجلات',report.rows.length],['الأعمدة المختارة',report.columns.map(c=>c.label).join('، ')],['دلالة الفراغ','خانة فارغة = غير مسجل أو غير منطبق؛ الصفر قيمة فعلية'],['نطاق الإجماليات','جميع السجلات المطابقة عند التصدير؛ لا تتغير بتصفية Excel لاحقًا'],['المقياس','القيمة','الوحدة'],...report.metrics.map(m=>[m.label,m.value,m.unit])];
  metadata.forEach((values,i)=>{const row=overview.addRow(values);row.font={name:'Arial',size:11,color:{argb:INK}};row.alignment={horizontal:'right',vertical:'middle',wrapText:true};row.height=Math.max(25,Math.ceil(String(values[1]??'').length/65)*16);if(i===0||i===8){row.fill={type:'pattern',pattern:'solid',fgColor:{argb:TEAL}};row.font={name:'Arial',size:i===0?16:11,bold:true,color:{argb:'FFFFFFFF'}};}else if(i%2)row.fill={type:'pattern',pattern:'solid',fgColor:{argb:SOFT}};});
  if(report.sourceAt) overview.addRow(['تحديث البيانات',`${businessDateTime(report.sourceAt,report.timeZone)} — ${report.cached?'نسخة مخزنة محليًا':'بيانات متصلة'}`]);
  overview.getColumn(2).numFmt='#,##0.###';overview.pageSetup.printArea=`A1:C${overview.rowCount}`;
  const widths=report.columns.map(c=>c.width*5.2);
  const orientation=reportOrientation(widths,report.orientation);
  const available=orientation==='portrait'?527:774;
  const wide=widths.reduce((a,b)=>a+b,0)>available;
  const detail=wb.addWorksheet('التفاصيل',{views:[{rightToLeft:true,state:'frozen',ySplit:1}],pageSetup:{paperSize:9,orientation,fitToPage:!wide,fitToWidth:wide?0:1,fitToHeight:0,...(wide?{scale:100}:{}),showGridLines:false,margins:{left:.47,right:.47,top:.65,bottom:.65,header:.25,footer:.25}}});
  detail.addTable({name:'AomsReportData',ref:'A1',headerRow:true,totalsRow:false,style:{theme:'TableStyleMedium2',showRowStripes:true},columns:report.columns.map(c=>({name:c.label,filterButton:true})),rows:report.rows.map(r=>report.columns.map(c=>excelValue(c,r[c.key])))});
  report.columns.forEach((c,i)=>{const col=detail.getColumn(i+1);col.width=c.width;col.numFmt=c.type==='date'?'dd/mm/yyyy':c.type==='number'?'#,##0.###':'@';});
  detail.eachRow((row,i)=>{row.font={name:'Arial',size:11,color:{argb:INK}};row.alignment={vertical:'top',horizontal:'right',wrapText:true};let lines=1;report.columns.forEach((c,j)=>{const v=row.getCell(j+1).value;const text=v instanceof Date?'00/00/0000':String(v??'');lines=Math.max(lines,...text.split('\n').map(t=>Math.ceil(t.length/Math.max(8,c.width-3))));});row.height=Math.max(27,lines*15+8);if(i===1){row.font={name:'Arial',bold:true,size:11,color:{argb:'FFFFFFFF'}};row.fill={type:'pattern',pattern:'solid',fgColor:{argb:TEAL}};}});
  detail.pageSetup.printTitlesRow='1:1';detail.pageSetup.printArea=`A1:${detail.getColumn(report.columns.length).letter}${Math.max(1,detail.rowCount)}`;
  let identity=0;for(let i=0;i<Math.min(3,report.columns.length);i++){if(['log_date','event_date','transaction_date','asset_code'].includes(report.columns[i].key))identity=i+1;}
  if(identity)detail.pageSetup.printTitlesColumn=`A:${detail.getColumn(identity).letter}`;
  const literal=s=>String(s).replace(/&/g,'&&');
  for(const ws of [overview,detail])ws.headerFooter={oddHeader:`&R${literal(title)}`,oddFooter:`&R${literal(report.sortLabel)}&Cصفحة &P من &N&L AOMS`};
  const buffer=await wb.xlsx.writeBuffer();save(new Blob([buffer],{type:'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'}),filename(report,'xlsx'));return wb;
}

export async function writePDF(report,title,fonts=null){
  if(report.rows.length>10000)throw new Error('حد PDF هو 10000 سجل؛ قلص الفترة أو استخدم Excel');
  const [{jsPDF},{default:autoTable},{amiriRegular,amiriBold}]=await Promise.all([import('jspdf'),import('jspdf-autotable'),fonts?Promise.resolve(fonts):loadAmiriFonts()]);
  const probe=new jsPDF({unit:'pt'});probe.addFileToVFS('Amiri-Regular.ttf',amiriRegular);probe.addFont('Amiri-Regular.ttf','Amiri','normal');probe.setFont('Amiri');probe.setFontSize(10.5);
  const widths=report.columns.map(c=>{
    let longest=0;
    for(const text of [c.label,...report.rows.map(r=>String(r[c.key]??''))]) for(const word of String(text).split(/\s+/)) longest=Math.max(longest,probe.getTextWidth(word));
    return Math.max(84,Math.min(160,longest*1.4+18));
  });
  const orientation=reportOrientation(widths,report.orientation);const doc=new jsPDF({orientation,unit:'pt',format:'a4',compress:true,putOnlyUsedFonts:true});
  for(const [style,data] of [['normal',amiriRegular],['bold',amiriBold]]){const name=`Amiri-${style}.ttf`;doc.addFileToVFS(name,data);doc.addFont(name,'Amiri',style);}
  // ActualText preserves logical Unicode for search/copy, independent of Arabic glyph shaping.
  const drawText=doc.text.bind(doc);
  const bidi=bidiFactory();
  const reorder=text=>bidi.getReorderedString(text,bidi.getEmbeddingLevels(text,'rtl'));
  doc.text=(value,...args)=>{
    const logical=(Array.isArray(value)?value.join('\n'):String(value)).replace(/←/g,'إلى');
    const searchable=logical.split('\n').map(reorder).join('\n');
    let hex='FEFF';for(let i=0;i<searchable.length;i++)hex+=searchable.charCodeAt(i).toString(16).padStart(4,'0');
    doc.internal.write(`/Span << /ActualText <${hex}> >> BDC`);
    const visual=logical.split('\n').map(line=>reorder(doc.processArabic(line)));
    args[2]={...args[2],isInputVisual:true,isInputRtl:false,isOutputVisual:true,isOutputRtl:false,isSymmetricSwapping:false};
    const result=drawText(Array.isArray(value)?visual:visual[0],...args);
    doc.internal.write('EMC');return result;
  };
  doc.setLanguage('ar');doc.setProperties({title,subject:`${report.filtersSummary} — ${report.sortLabel}`,creator:'AOMS'});
  const pageWidth=doc.internal.pageSize.getWidth(),pageHeight=doc.internal.pageSize.getHeight(),margin=34,available=pageWidth-2*margin;
  const identity=report.columns.map((c,i)=>['log_date','event_date','transaction_date','asset_code'].includes(c.key)?i:-1).filter(i=>i>=0).slice(0,2);
  const all=report.columns.map((_,i)=>i);const bands=[];
  if(widths.reduce((s,n)=>s+n,0)<=available)bands.push(all);
  else {let group=[];let used=identity.reduce((s,i)=>s+widths[i],0);for(const i of all.filter(i=>!identity.includes(i))){if(group.length&&used+widths[i]>available){bands.push([...identity,...group]);group=[];used=identity.reduce((s,j)=>s+widths[j],0);}group.push(i);used+=widths[i];}if(group.length)bands.push([...identity,...group]);if(!bands.length)bands.push(identity);}
  const header=(band=0)=>{doc.setFillColor(17,94,89);doc.rect(0,0,pageWidth,54,'F');doc.setFont('Amiri','bold');doc.setFontSize(14);doc.setTextColor(255,255,255);doc.text(title,pageWidth-margin,24,{align:'right',...PDF_RTL_TEXT_OPTIONS});doc.setFontSize(10);doc.text(`${report.sortLabel} — مجموعة أعمدة ${band+1} من ${bands.length}`,pageWidth-margin,43,{align:'right',...PDF_RTL_TEXT_OPTIONS});doc.setTextColor(15,23,42);};
  header();let y=76;const lines=text=>{doc.setFont('Amiri','normal');doc.setFontSize(10.5);for(const line of doc.splitTextToSize(text,available)){if(y>pageHeight-60){doc.addPage();header();y=76;}doc.text(line,pageWidth-margin,y,{align:'right',...PDF_RTL_TEXT_OPTIONS});y+=15;}};
  lines(`الفلاتر: ${report.filtersSummary}`);lines(`وقت التصدير: ${businessDateTime(report.generatedAt,report.timeZone)} (${report.timeZone||'Asia/Jerusalem'})`);
  if(report.sourceAt)lines(`تحديث البيانات: ${businessDateTime(report.sourceAt,report.timeZone)} — ${report.cached?'نسخة مخزنة محليًا':'بيانات متصلة'}`);
  lines('دلالة الفراغ: غير مسجل أو غير منطبق. الإجماليات لجميع النتائج المطابقة عند التصدير.');
  for(const m of report.metrics)lines(`${m.label}: ${m.value} ${m.unit}`);
  bands.forEach((band,bandIndex)=>{
    if(bandIndex){doc.addPage();y=74;}
    const indices=[...band].reverse(),styles={};indices.forEach((id,i)=>{styles[i]={cellWidth:widths[id]};});
    const tableWidth=indices.reduce((sum,i)=>sum+widths[i],0);
    autoTable(doc,{tableWidth,startY:y+10,margin:{left:pageWidth-margin-tableWidth,right:margin,top:72,bottom:36},head:[indices.map(i=>report.columns[i].label)],body:report.rows.map(r=>indices.map(i=>{const c=report.columns[i],v=r[c.key];return v==null||v===''?'—':String(c.format?c.format(v,r):v);})),columnStyles:styles,showHead:'everyPage',rowPageBreak:'avoid',styles:{font:'Amiri',fontSize:10.5,halign:'right',cellPadding:5,overflow:'linebreak',textOptions:{...PDF_RTL_TEXT_OPTIONS},textColor:[15,23,42]},headStyles:{fontStyle:'bold',fillColor:[17,94,89],textColor:[255,255,255]},alternateRowStyles:{fillColor:[248,250,252]},didDrawPage:()=>header(bandIndex)});
  });
  const pages=doc.getNumberOfPages();for(let i=1;i<=pages;i++){doc.setPage(i);doc.setFont('Amiri','normal');doc.setTextColor(71,85,105);doc.setFontSize(10);doc.text(`صفحة ${i} من ${pages}`,pageWidth/2,pageHeight-16,{align:'center'});}
  if(typeof window!=='undefined'&&typeof URL?.createObjectURL==='function')doc.save(filename(report,'pdf'));return doc;
}
