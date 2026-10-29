import { useMemo, useState } from 'react';
import { Alert, Box, Button, Checkbox, Dialog, DialogActions, DialogContent, DialogTitle, FormControlLabel, MenuItem, Stack, Switch, Typography } from '@mui/material';
import TextField from './AppTextField';
import { getAomsReportColumns, exportAomsExcel, exportAomsPDF } from '../services/aomsReportService';
import { prepareReportExport } from '../domain/reportExportModel';

export default function ReportExportDialog({ snapshot, onClose, onError, currentSourceAt, onRefresh }) {
  const columns = useMemo(() => getAomsReportColumns(snapshot.report.type, snapshot.report.dynamicColumns),[snapshot]);
  const [keys,setKeys] = useState(() => columns.map(c=>c.key));
  const [query,setQuery] = useState(''); const [newest,setNewest] = useState(true); const [orientation,setOrientation] = useState('auto'); const [busy,setBusy] = useState(false);
  const [localError,setLocalError] = useState('');
  const group = c => c.key.startsWith('dyn_')?'الحقول الديناميكية':/asset|category/.test(c.key)?'تعريف الأصل':/date|event|record_type/.test(c.key)?'التاريخ والحدث':/reading|net_operation|meter_unit/.test(c.key)?'القراءات':/fuel/.test(c.key)?'الوقود':/water|tanker|trips|distributed|network/.test(c.key)?'المياه':/chlorine/.test(c.key)?'الكلور':'التفاصيل';
  const visible = columns.filter(c => c.label.includes(query));
  const prepared = useMemo(() => keys.length ? prepareReportExport(snapshot.report,columns,{columnKeys:keys,newestFirst:newest,orientation,generatedAt:snapshot.at,format:snapshot.format}) : null,[snapshot,columns,keys,newest,orientation]);
  const exportFile = async () => {
    setBusy(true); setLocalError('');
    await new Promise(resolve=>requestAnimationFrame(()=>setTimeout(resolve,0)));
    try { const options={columnKeys:keys,newestFirst:newest,orientation,generatedAt:snapshot.at};
      if(snapshot.format==='excel') await exportAomsExcel(snapshot.report,snapshot.title,snapshot.report.filtersSummary,options);
      else await exportAomsPDF(snapshot.report,snapshot.title,snapshot.report.filtersSummary,null,options);
      onClose();
    } catch(e) {setLocalError(e.message);onError?.(e);} finally {setBusy(false);}
  };
  return <Dialog open onClose={() => !busy && onClose()} fullWidth maxWidth="md" className="report-export-dialog" aria-labelledby="export-dialog-title">
    <DialogTitle id="export-dialog-title">إعداد تقرير {snapshot.format==='excel'?'Excel':'PDF'}</DialogTitle>
    <DialogContent dividers>
      <Typography sx={{mb:1,overflowWrap:'anywhere'}}>{snapshot.report.filtersSummary}</Typography>
      <Typography variant="body2">{snapshot.report.rows.length} سجل مطابق — {keys.length} من {columns.length} عمودًا</Typography>
      <Alert severity="info" sx={{my:2}}>يشمل الملف جميع النتائج المطابقة للفلاتر. المعاينة عينة فقط. بيانات التقرير ثابتة منذ فتح هذه النافذة.</Alert>
      <Typography variant="body2">وقت لقطة التقرير: {new Date(snapshot.at).toLocaleString('ar',{timeZone:snapshot.report.timeZone||'Asia/Jerusalem'})} — {snapshot.report.cached?'نسخة محلية محفوظة':'بيانات متصلة'}</Typography>
      {currentSourceAt && snapshot.report.sourceAt && currentSourceAt!==snapshot.report.sourceAt && <Alert severity="warning" action={<Button disabled={busy} onClick={onRefresh}>تحديث المعاينة</Button>}>وصل تحديث أحدث للبيانات؛ الملف الحالي يستخدم اللقطة السابقة.</Alert>}
      {localError && <Alert severity="error">{localError}</Alert>}
      <Stack direction={{xs:'column',sm:'row'}} spacing={2} sx={{mb:2}}>
        <FormControlLabel control={<Switch disabled={busy} checked={newest} onChange={e=>setNewest(e.target.checked)} />} label={`الأحدث أولًا — الترتيب الحالي: ${newest?'الأحدث أولًا':'الأقدم أولًا'}`} />
        <TextField disabled={busy} select label="اتجاه A4" value={orientation} onChange={e=>setOrientation(e.target.value)} sx={{minWidth:180}}>
          <MenuItem value="auto">تلقائي حسب عرض الأعمدة</MenuItem><MenuItem value="portrait">طولي</MenuItem><MenuItem value="landscape">عرضي</MenuItem>
        </TextField>
      </Stack>
      <TextField disabled={busy} fullWidth label="البحث عن عمود" value={query} onChange={e=>setQuery(e.target.value)} />
      <Stack direction="row" spacing={1} sx={{my:1}}><Button disabled={busy} onClick={()=>setKeys(columns.map(c=>c.key))}>تحديد الكل</Button><Button disabled={busy} onClick={()=>setKeys([])}>إلغاء الكل</Button><Button disabled={busy} onClick={()=>{setKeys(columns.map(c=>c.key));setNewest(true);setOrientation('auto');}}>استعادة الافتراضي</Button></Stack>
      <Box sx={{display:'grid',gridTemplateColumns:{xs:'1fr',sm:'1fr 1fr'},maxHeight:300,overflow:'auto',border:1,borderColor:'divider',p:1,borderRadius:2}}>
        {[...new Set(visible.map(group))].map(name=><Box key={name}><Typography fontWeight={700}>{name}</Typography>{visible.filter(c=>group(c)===name).map(c=><FormControlLabel key={c.key} control={<Checkbox disabled={busy} checked={keys.includes(c.key)} onChange={e=>setKeys(old=>e.target.checked?columns.filter(x=>old.includes(x.key)||x.key===c.key).map(x=>x.key):old.filter(k=>k!==c.key))}/>} label={c.label}/>)}</Box>)}
        {!visible.length && <Typography>لا توجد حقول بهذا الاسم</Typography>}
      </Box>
      {!keys.length && <Alert severity="warning" sx={{mt:2}}>اختر عمودًا واحدًا على الأقل</Alert>}
      {prepared && <Box sx={{overflow:'auto',mt:2}}><Typography fontWeight={700}>معاينة أول 3 سجلات — {prepared.sortLabel}</Typography><table className="export-preview"><thead><tr>{prepared.columns.map(c=><th key={c.key}>{c.label}</th>)}</tr></thead><tbody>{prepared.rows.slice(0,3).map((r,i)=><tr key={i}>{prepared.columns.map(c=><td key={c.key}>{String(c.format?c.format(r[c.key],r):r[c.key]??'—')}</td>)}</tr>)}</tbody></table></Box>}
    </DialogContent>
    <DialogActions><Button onClick={onClose} disabled={busy}>إلغاء</Button><Button variant="contained" disabled={!keys.length||busy} onClick={exportFile}>{busy?'جارٍ إنشاء الملف…':snapshot.format==='excel'?'إنشاء Excel':'إنشاء PDF'}</Button></DialogActions>
  </Dialog>;
}
