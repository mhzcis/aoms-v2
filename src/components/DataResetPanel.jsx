import { useState } from 'react';
import { Alert, Button, Checkbox, Dialog, DialogActions, DialogContent, DialogTitle, FormControlLabel, Paper, Stack, Typography } from '@mui/material';
import TextField from './AppTextField';
import { RESET_CONFIRMATION } from '../domain/workflowSettings';

export default function DataResetPanel({service,disabled,runAction,onBackup,labels}) {
  const [preview,setPreview]=useState(null),[confirmation,setConfirmation]=useState(''),[backedUp,setBackedUp]=useState(false),[ack,setAck]=useState(false),[busy,setBusy]=useState(false),[error,setError]=useState('');
  const act=async fn=>{setBusy(true);setError('');try{await fn();}catch(e){setError(e.message);}finally{setBusy(false);}};
  return <Paper sx={{p:3,mb:3,border:1,borderColor:'error.main'}}>
    <Typography variant="h6" fontWeight={800}>مسح شامل لبيانات التطبيق</Typography>
    <Typography sx={{my:1}}>يمسح الأصول والتصنيفات والمشغلين وأنواع الوقود والحقول وسجلات التشغيل والوقود والكلور والخط الزمني. تبقى حسابات المستخدمين والإعدادات وسجل التدقيق الإداري.</Typography>
    <Button color="error" variant="outlined" disabled={disabled||busy} onClick={()=>act(async()=>{setPreview(await service.previewReset());setConfirmation('');setAck(false);setBackedUp(false);})}>معاينة المسح الشامل</Button>
    {error&&!preview&&<Alert severity="error">{error}</Alert>}
    <Dialog open={Boolean(preview)} onClose={()=>!busy&&setPreview(null)} maxWidth="sm" fullWidth aria-labelledby="reset-title">
      <DialogTitle id="reset-title">تأكيد المسح الشامل — إجراء لا يمكن التراجع عنه دون نسخة احتياطية</DialogTitle>
      <DialogContent dividers><Alert severity="error" sx={{mb:2}}>سيتم حذف البيانات المبينة أدناه. تبقى حسابات المستخدمين والإعدادات وسجل التدقيق. لم يبدأ المسح بعد.</Alert>
        {Object.entries(preview?.counts||{}).map(([key,count])=><Typography key={key}>{labels[key]||key}: {count}</Typography>)}
        <Stack spacing={2} sx={{mt:2}}>
          <Button variant="outlined" disabled={busy} onClick={()=>act(async()=>{await onBackup();setBackedUp(true);})}>تنزيل نسخة أمان قبل المسح</Button>
          <FormControlLabel control={<Checkbox disabled={!backedUp||busy} checked={ack} onChange={e=>setAck(e.target.checked)}/>} label="تحققت من حفظ نسخة الأمان وأفهم أن جميع البيانات المبينة ستحذف" />
          <TextField label="اكتب مسح شامل للتأكيد" value={confirmation} onChange={e=>setConfirmation(e.target.value)} disabled={busy}/>
          {error&&<Alert severity="error">{error}</Alert>}
        </Stack>
      </DialogContent><DialogActions><Button disabled={busy} onClick={()=>setPreview(null)}>إلغاء</Button><Button color="error" variant="contained" disabled={disabled||busy||!backedUp||!ack||confirmation!==RESET_CONFIRMATION} onClick={()=>act(async()=>{await runAction(()=>service.resetData(confirmation,preview.fingerprint),'تم المسح الشامل وحفظ سجل العملية');setPreview(null);})}>{busy?'جارٍ التنفيذ…':'تنفيذ المسح الشامل'}</Button></DialogActions>
    </Dialog>
  </Paper>;
}
