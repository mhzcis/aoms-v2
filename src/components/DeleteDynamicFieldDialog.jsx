import { useState } from 'react';
import { Alert, Button, Dialog, DialogActions, DialogContent, DialogTitle, Stack, Typography } from '@mui/material';
import TextField from './AppTextField';

export default function DeleteDynamicFieldDialog({ field, counts, disabled, onClose, onDelete }) {
  const [confirmation,setConfirmation]=useState(''),[busy,setBusy]=useState(false),[error,setError]=useState('');
  return <Dialog open onClose={busy?undefined:onClose} fullWidth maxWidth="sm">
    <DialogTitle>حذف الحقل الديناميكي: {field.label}</DialogTitle>
    <DialogContent><Stack spacing={2} sx={{pt:1}}>
      <Alert severity="warning">سيُحذف الحقل وخياراته وجميع قيمه التاريخية من الأصول وسجلات التشغيل. تبقى الأصول وسجلات التشغيل نفسها محفوظة، وتُحفظ نسخة من البيانات المحذوفة في سجل التدقيق.</Alert>
      <Typography>قيم الأصول: {counts.assets} — قيم التشغيل: {counts.operations} — الخيارات: {counts.options}</Typography>
      <TextField autoFocus label="اكتب حذف الحقل للتأكيد" value={confirmation} onChange={e=>setConfirmation(e.target.value)} disabled={busy}/>
      {error&&<Alert severity="error">{error}</Alert>}
    </Stack></DialogContent>
    <DialogActions><Button onClick={onClose} disabled={busy}>إلغاء</Button>
      <Button color="error" variant="contained" disabled={disabled||busy||confirmation!=='حذف الحقل'} onClick={async()=>{
        setBusy(true);setError('');try{await onDelete(confirmation);onClose();}catch(e){setError(e.message);}finally{setBusy(false);}
      }}>حذف الحقل وقيمه</Button>
    </DialogActions>
  </Dialog>;
}
