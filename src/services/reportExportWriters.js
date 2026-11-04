import bidiFactory from 'bidi-js';
import { businessDateTime } from '../utils/businessTime';
import { loadReportFonts, REPORT_FONT } from '../assets/fonts/reportFontData';
import { TOTALS_NOTE } from '../domain/reportTableModel';
import { reportOrientation } from '../domain/reportExportModel';

// Dark blue keeps white table headings legible; UN blue provides the accent.
const PDF_FONT='NotoNaskhArabic';
const BLUE='FF006F9E', INK='FF0F172A', SOFT='FFEDF7FC';
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

const CELL_BORDER={bottom:{style:'hair',color:{argb:'FFE2E8F0'}}};
const fill=color=>({type:'pattern',pattern:'solid',fgColor:{argb:color}});
function paintCells(row,count,{background='FFFFFFFF',color=INK,bold=false,size=11,border=CELL_BORDER}={}) {
  // Never set row.fill/font/alignment: row styles extend past the table in Excel.
  for(let i=1;i<=count;i++)Object.assign(row.getCell(i),{
    fill:fill(background),font:{name:REPORT_FONT,size,bold,color:{argb:color}},
    alignment:{horizontal:'center',vertical:'middle',wrapText:true},border,
  });
}
export async function writeExcel(report,title){
  if(report.rows.length>100000)throw new Error('حد Excel هو 100000 سجل؛ قلص فترة التقرير');
  const {default:ExcelJS}=await import('exceljs');
  const wb=new ExcelJS.Workbook();wb.creator='AOMS';wb.created=new Date(report.generatedAt);wb.title=title;wb.calcProperties={fullCalcOnLoad:true};
  const overview=wb.addWorksheet('الملخص',{views:[{rightToLeft:true,showGridLines:false}],properties:{tabColor:{argb:BLUE}},pageSetup:{paperSize:9,orientation:'portrait',fitToPage:true,fitToWidth:1,fitToHeight:0,margins:{left:.47,right:.47,top:.65,bottom:.65,header:.25,footer:.25}}});
  overview.columns=[{width:34},{width:76}];
  const metadata=[['التقرير',title],['الفلاتر',report.filtersSummary],['الترتيب',report.sortLabel],['وقت التصدير',`${businessDateTime(report.generatedAt,report.timeZone)} (${report.timeZone||'Asia/Jerusalem'})`],['عدد السجلات',report.rows.length],['الأعمدة المختارة',report.columns.map(c=>c.label).join('، ')],['دلالة الفراغ','خانة فارغة = غير مسجل أو غير منطبق؛ الصفر قيمة فعلية'],['نطاق الإجماليات','الملخص ثابت لجميع النتائج؛ صف إجماليات التفاصيل يعرض الصفوف الظاهرة بعد تصفية Excel'],['المقياس','الإجمالي'],...report.metrics.map(m=>[`${m.label}${m.unit?` (${m.unit})`:''}`,m.value])];
  metadata.forEach((values,i)=>{
    const row=overview.addRow(values);const heading=i===0||i===8;
    paintCells(row,2,{background:heading?BLUE:i%2?SOFT:'FFFFFFFF',color:heading?'FFFFFFFF':INK,bold:heading,size:i===0?14:11});
    row.height=Math.max(i===0?48:29,Math.ceil(String(values[1]??'').length/65)*17+12);
    if(!heading)row.getCell(1).font={name:REPORT_FONT,size:10,bold:true,color:{argb:'FF475569'}};
    if(i>8)row.getCell(2).numFmt=Number.isInteger(values[1])?'#,##0':'#,##0.###';
  });
  const note=overview.addRow(['قاعدة الجمع',TOTALS_NOTE]);paintCells(note,2,{background:SOFT,size:10});note.height=48;
  if(report.sourceAt){const row=overview.addRow(['تحديث البيانات',`${businessDateTime(report.sourceAt,report.timeZone)} — ${report.cached?'نسخة مخزنة محليًا':'بيانات متصلة'}`]);paintCells(row,2);row.height=32;}
  overview.pageSetup.printArea=`A1:B${overview.rowCount}`;
  const widths=report.columns.map(c=>c.width*5.2),orientation=reportOrientation(widths,report.orientation);
  const available=orientation==='portrait'?527:774,wide=widths.reduce((a,b)=>a+b,0)>available;
  const detail=wb.addWorksheet('التفاصيل',{views:[{rightToLeft:true,state:'frozen',ySplit:1,showGridLines:false}],properties:{tabColor:{argb:'FF009EDB'}},pageSetup:{paperSize:9,orientation,fitToPage:!wide,fitToWidth:wide?0:1,fitToHeight:0,...(wide?{scale:100}:{}),showGridLines:false,margins:{left:.47,right:.47,top:.65,bottom:.65,header:.25,footer:.25}}});
  detail.addTable({name:'AomsReportData',ref:'A1',headerRow:true,totalsRow:false,style:{theme:null,showRowStripes:false},columns:report.columns.map(c=>({name:c.label,filterButton:true})),rows:report.rows.map(r=>report.columns.map(c=>excelValue(c,r[c.key])))});
  report.columns.forEach((c,i)=>{detail.getColumn(i+1).width=c.width;});
  detail.eachRow((row,i)=>{
    paintCells(row,report.columns.length,{background:i===1?BLUE:i%2===0?'FFF1F6FA':'FFFFFFFF',color:i===1?'FFFFFFFF':INK,bold:i===1});
    let lines=1;report.columns.forEach((c,j)=>{
      const cell=row.getCell(j+1),v=cell.value,text=v instanceof Date?'00/00/0000':String(v??'');
      cell.numFmt=i===1?'@':c.type==='date'?'dd/mm/yyyy':c.type==='number'?(Number.isInteger(v)?'#,##0':'#,##0.###'):'@';
      for(const line of text.split('\n'))lines=Math.max(lines,Math.ceil(line.length/Math.max(8,c.width-3)));
    });row.height=Math.max(i===1?48:29,lines*16+10);
  });
  const totalRow=detail.getRow(report.rows.length+2),totals=report.totals||{};
  paintCells(totalRow,report.columns.length,{background:BLUE,color:'FFFFFFFF',bold:true,border:{top:{style:'medium',color:{argb:'FF009EDB'}}}});totalRow.height=36;
  report.columns.forEach((c,i)=>{
    const cell=totalRow.getCell(i+1),hasTotal=Object.hasOwn(totals,c.key);
    if(hasTotal){cell.value=report.rows.length?{formula:`SUBTOTAL(109,${cell.address.replace(/\d+$/,'')}2:${cell.address.replace(/\d+$/,'')}${report.rows.length+1})`,result:totals[c.key]}:0;const fmt=Number.isInteger(totals[c.key])?'#,##0':'#,##0.###';cell.numFmt=c.key===report.totalLabelKey?`"الإجمالي: "${fmt}`:fmt;}
    else {cell.value=c.key===report.totalLabelKey?'الإجمالي':'—';cell.numFmt='@';}
  });
  detail.pageSetup.printTitlesRow='1:1';detail.pageSetup.printArea=`A1:${detail.getColumn(report.columns.length).letter}${totalRow.number}`;
  let identity=0;for(let i=0;i<Math.min(3,report.columns.length);i++){if(['log_date','event_date','transaction_date','asset_code'].includes(report.columns[i].key))identity=i+1;}
  if(identity&&identity<report.columns.length)detail.views=[{rightToLeft:true,state:'frozen',xSplit:identity,ySplit:1,showGridLines:false}];
  if(identity)detail.pageSetup.printTitlesColumn=`A:${detail.getColumn(identity).letter}`;
  const literal=s=>String(s).replace(/&/g,'&&');
  for(const ws of [overview,detail])ws.headerFooter={oddHeader:`&R${literal(title)}`,oddFooter:`&R${literal(report.sortLabel)}&Cصفحة &P من &N&L AOMS`};
  const buffer=await wb.xlsx.writeBuffer();save(new Blob([buffer],{type:'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'}),filename(report,'xlsx'));return wb;
}

export async function writePDF(report,title,fonts=null){
  if(report.rows.length>10000)throw new Error('حد PDF هو 10000 سجل؛ قلص الفترة أو استخدم Excel');
  const [{jsPDF},{default:autoTable},{regular,bold}]=await Promise.all([import('jspdf'),import('jspdf-autotable'),fonts?Promise.resolve(fonts):loadReportFonts()]);
  const probe=new jsPDF({unit:'pt'});probe.addFileToVFS('NotoNaskhArabic-Regular.ttf',regular);probe.addFont('NotoNaskhArabic-Regular.ttf',PDF_FONT,'normal');probe.setFont(PDF_FONT);probe.setFontSize(10.5);
  const widths=report.columns.map(c=>{
    let longest=0;
    for(const text of [c.label,...report.rows.map(r=>String(r[c.key]??''))]) for(const word of String(text).split(/\s+/)) longest=Math.max(longest,probe.getTextWidth(word));
    return Math.max(84,Math.min(160,longest*1.4+18));
  });
  const orientation=reportOrientation(widths,report.orientation);const doc=new jsPDF({orientation,unit:'pt',format:'a4',compress:true,putOnlyUsedFonts:true});
  for(const [style,data] of [['normal',regular],['bold',bold]]){const name=`NotoNaskhArabic-${style}.ttf`;doc.addFileToVFS(name,data);doc.addFont(name,PDF_FONT,style);}
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
  const header=(band=0)=>{doc.setFillColor(0,111,158);doc.rect(0,0,pageWidth,54,'F');doc.setFillColor(0,158,219);doc.rect(0,54,pageWidth,3,'F');doc.setFont(PDF_FONT,'bold');doc.setFontSize(14);doc.setTextColor(255,255,255);doc.text(title,pageWidth-margin,24,{align:'right',...PDF_RTL_TEXT_OPTIONS});doc.setFontSize(10);doc.text(`${report.sortLabel} — مجموعة أعمدة ${band+1} من ${bands.length}`,pageWidth-margin,43,{align:'right',...PDF_RTL_TEXT_OPTIONS});doc.setTextColor(15,23,42);};
  header();let y=76;const lines=text=>{doc.setFont(PDF_FONT,'normal');doc.setFontSize(10.5);for(const line of doc.splitTextToSize(text,available)){if(y>pageHeight-60){doc.addPage();header();y=76;}doc.text(line,pageWidth-margin,y,{align:'right',...PDF_RTL_TEXT_OPTIONS});y+=15;}};
  lines(`الفلاتر: ${report.filtersSummary}`);lines(`وقت التصدير: ${businessDateTime(report.generatedAt,report.timeZone)} (${report.timeZone||'Asia/Jerusalem'})`);
  if(report.sourceAt)lines(`تحديث البيانات: ${businessDateTime(report.sourceAt,report.timeZone)} — ${report.cached?'نسخة مخزنة محليًا':'بيانات متصلة'}`);
  lines('دلالة الفراغ: غير مسجل أو غير منطبق. الإجماليات لجميع النتائج المطابقة عند التصدير.');
  lines(TOTALS_NOTE);
  // Compact metric cards keep the first page readable without an extra cover.
  const cardWidth=(available-16)/3;
  report.metrics.forEach((m,i)=>{
    if(i%3===0){if(y+52>pageHeight-60){doc.addPage();header();y=76;}y+=4;}
    const x=pageWidth-margin-cardWidth-(i%3)*(cardWidth+8);
    doc.setFillColor(237,247,252);doc.roundedRect(x,y,cardWidth,43,3,3,'F');doc.setFont(PDF_FONT,'normal');doc.setFontSize(9.5);
    doc.text(`${m.label}${m.unit?` (${m.unit})`:''}`,x+cardWidth/2,y+14,{align:'center'});
    doc.setFont(PDF_FONT,'bold');doc.setFontSize(14);doc.setTextColor(0,111,158);doc.text(String(m.value),x+cardWidth/2,y+33,{align:'center'});doc.setTextColor(15,23,42);
    if(i%3===2||i===report.metrics.length-1)y+=48;
  });
  bands.forEach((band,bandIndex)=>{
    if(bandIndex){doc.addPage();y=74;}
    const indices=[...band].reverse(),styles={};indices.forEach((id,i)=>{styles[i]={cellWidth:widths[id]};});
    const tableWidth=indices.reduce((sum,i)=>sum+widths[i],0);
    const foot=indices.map(i=>{const c=report.columns[i],v=report.totals?.[c.key];return v!=null?(c.key===report.totalLabelKey?`الإجمالي: ${v}`:String(v)):c.key===report.totalLabelKey?'الإجمالي':'—';});
    if(!band.some(i=>report.columns[i].key===report.totalLabelKey)){const at=indices.findIndex(i=>report.totals?.[report.columns[i].key]==null);if(at>=0)foot[at]='الإجمالي';else foot[foot.length-1]=`الإجمالي: ${foot[foot.length-1]}`;}
    autoTable(doc,{tableWidth,startY:y+10,margin:{left:pageWidth-margin-tableWidth,right:margin,top:72,bottom:36},head:[indices.map(i=>report.columns[i].label)],body:report.rows.map(r=>indices.map(i=>{const c=report.columns[i],v=r[c.key];return v==null||v===''?'—':String(c.format?c.format(v,r):v);})),foot:[foot],showFoot:'lastPage',columnStyles:styles,showHead:'everyPage',rowPageBreak:'avoid',styles:{font:PDF_FONT,fontSize:10.5,halign:'center',valign:'middle',cellPadding:6,overflow:'linebreak',textOptions:{...PDF_RTL_TEXT_OPTIONS},textColor:[15,23,42]},headStyles:{fontStyle:'bold',halign:'center',valign:'middle',fillColor:[0,111,158],textColor:[255,255,255]},footStyles:{fontStyle:'bold',halign:'center',valign:'middle',fillColor:[0,111,158],textColor:[255,255,255],lineColor:[0,158,219],lineWidth:{top:1.5}},alternateRowStyles:{fillColor:[248,250,252]},didDrawPage:()=>header(bandIndex)});
  });
  const pages=doc.getNumberOfPages();for(let i=1;i<=pages;i++){doc.setPage(i);doc.setFont(PDF_FONT,'normal');doc.setTextColor(71,85,105);doc.setFontSize(10);doc.setDrawColor(203,213,225);doc.setLineWidth(.5);doc.line(margin,pageHeight-29,pageWidth-margin,pageHeight-29);doc.text(`صفحة ${i} من ${pages}`,pageWidth/2,pageHeight-16,{align:'center'});}
  // Distinct PDF font names prevent readers from sharing glyph caches between weights.
  for(const style of ['normal','bold'])doc.internal.getFont(PDF_FONT,style).fontName=`${PDF_FONT}-${style}`;
  if(typeof window!=='undefined'&&typeof URL?.createObjectURL==='function')doc.save(filename(report,'pdf'));return doc;
}
