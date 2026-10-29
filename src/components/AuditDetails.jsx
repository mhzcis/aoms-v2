import { useState } from 'react';
import { Box, Button, Dialog, DialogActions, DialogContent, DialogTitle, Grid, Typography } from '@mui/material';
import { businessDateTime } from '../utils/businessTime';

export function auditActor(log, profiles = []) {
  const id = log.user_id || log.actor_id || log.created_by;
  return profiles.find(p => p.id === id)?.full_name || id || 'غير مسجل';
}

export function auditChanges(before, after) {
  return [...new Set([...Object.keys(before || {}), ...Object.keys(after || {})])]
    .filter(key => JSON.stringify(before?.[key]) !== JSON.stringify(after?.[key]));
}

export default function AuditDetails({ log, profiles, timeZone }) {
  const [open, setOpen] = useState(false);
  const fields = auditChanges(log.before_json, log.after_json);
  return <>
    <Button size="small" onClick={() => setOpen(true)} aria-label={`عرض تفاصيل التدقيق ${log.id}`}>عرض التفاصيل كاملة</Button>
    <Dialog open={open} onClose={() => setOpen(false)} fullWidth maxWidth="lg" aria-labelledby={`audit-${log.id}`}>
      <DialogTitle id={`audit-${log.id}`}>تفاصيل التغيير — {log.entity_type}</DialogTitle>
      <DialogContent dividers>
        <Typography>المنفذ: {auditActor(log, profiles)}</Typography>
        <Typography>الوقت: <bdi>{businessDateTime(log.created_at, timeZone)} ({timeZone})</bdi></Typography>
        <Typography sx={{ overflowWrap: 'anywhere' }}>معرّف السجل: <bdi>{log.entity_id || '—'}</bdi></Typography>
        <Typography sx={{ my: 2, overflowWrap: 'anywhere' }}>الحقول المتغيرة: <bdi>{fields.join('، ') || 'لا تغيير في القيم'}</bdi></Typography>
        <Grid container spacing={2}>
          {[[log.before_json, 'قبل التعديل'], [log.after_json, 'بعد التعديل']].map(([value, label]) => <Grid key={label} size={{ xs: 12, md: 6 }}>
            <Typography variant="h6">{label}</Typography>
            <Box component="pre" dir="ltr" sx={{ m: 0, p: 2, bgcolor: 'action.hover', whiteSpace: 'pre-wrap', overflowWrap: 'anywhere', textAlign: 'left' }}>{value ? JSON.stringify(value, null, 2) : '—'}</Box>
          </Grid>)}
        </Grid>
      </DialogContent>
      <DialogActions><Button onClick={() => setOpen(false)}>إغلاق</Button></DialogActions>
    </Dialog>
  </>;
}
