import TextField from './AppTextField';
import { useEffect, useMemo, useState } from 'react';
import {
  Alert,
  Button,
  FormControl,
  FormHelperText,
  InputLabel,
  MenuItem,
  Paper,
  Select,
  Stack,
  Typography,
} from '@mui/material';
import { useApp } from '../context/AppContext';
import { logDateRule, logHours } from '../utils/calculations';
import { dayName, niceDate } from '../utils/dates';
import { applyGenerator, editLogForm, newLogForm } from '../utils/logForm';

export default function LogForm({ edit, onDone, open, preset }) {
  const { data, saveLog } = useApp();
  const [f, setF] = useState(() =>
    edit ? editLogForm(edit, data.logs) : newLogForm(data.generators, data.logs, preset)
  );
  const [e, setE] = useState({});

  useEffect(() => {
    if (open) {
      setF(edit ? editLogForm(edit, data.logs) : newLogForm(data.generators, data.logs, preset));
      setE({});
    }
  }, [edit, open, preset]);

  const rule = useMemo(
    () => logDateRule(data.logs, f.generatorId, edit?.id),
    [data.logs, f.generatorId, edit]
  );
  const blocked = !edit && rule.blocked;
  const first = !rule.prev;
  const meter = f.recordType === 'meterReset';
  const hours = logHours(f.recordType, f.previousReading, f.currentReading);
  // القراءة السابقة قابلة للتحرير لأول سجل ولسجل تغيير العداد (قراءة بداية العداد الجديد).
  const prevEditable = first || meter;

  const change = k => x =>
    setF(
      k === 'generatorId' && !edit
        ? applyGenerator(f, data.logs, x.target.value)
        : k === 'recordType' && x.target.value === 'daily' && rule.prev
          ? { ...f, recordType: 'daily', previousReading: String(rule.prev.currentReading) }
          : { ...f, [k]: x.target.value }
    );

  const submit = () => {
    const r = saveLog(f);
    if (r.id) onDone(r.id);
    else setE(r);
  };

  return (
    <Paper
      sx={{
        p: 3,
        border: '2px solid',
        borderColor: f.recordType === 'meterReset' ? 'warning.main' : 'transparent',
        transition: '.25s',
      }}
    >
      <Typography variant="h6" mb={2}>
        {edit ? 'تعديل آخر سجل' : 'إضافة سجل تشغيل'}
      </Typography>
      {f.recordType === 'meterReset' && (
        <Alert severity="warning" sx={{ mb: 2 }}>
          تغيير عداد: أدخل في «القراءة السابقة» قراءة بداية العداد الجديد. تُحسب ساعات التشغيل من الفرق بين القراءتين وتُضاف إلى إجمالي الساعات، ويبدأ السجل التالي من القراءة الحالية.
        </Alert>
      )}
      {e.general && <Alert severity="error">{e.general}</Alert>}
      {blocked && (
        <Alert severity="error" sx={{ mb: 2 }}>
          يوجد سجل بتاريخ اليوم لهذا المولد، ولا يمكن إضافة سجل آخر له قبل اليوم التالي.
        </Alert>
      )}
      <Stack spacing={2}>
        <FormControl error={!!e.generatorId}>
          <InputLabel>المولد</InputLabel>
          <Select
            label="المولد"
            value={f.generatorId}
            onChange={change('generatorId')}
            disabled={!!edit}
          >
            {data.generators
              .filter(g => g.status === 'active' || g.id === f.generatorId)
              .map(g => (
                <MenuItem key={g.id} value={g.id}>
                  {g.number} | {g.name}
                </MenuItem>
              ))}
          </Select>
          <FormHelperText>{e.generatorId}</FormHelperText>
        </FormControl>

        <TextField
          type="date"
          label="التاريخ"
          InputLabelProps={{ shrink: true }}
          inputProps={{ max: rule.max, min: rule.min || undefined }}
          value={f.date}
          onChange={change('date')}
          error={!!e.date}
          helperText={
            e.date ||
            (rule.prev
              ? `يجب أن يكون بعد ${niceDate(rule.prev.date)}، تاريخ آخر سجل سابق لهذا المولد`
              : undefined)
          }
        />

        <TextField label="اليوم" value={dayName(f.date)} disabled />

        <FormControl>
          <InputLabel>نوع السجل</InputLabel>
          <Select label="نوع السجل" value={f.recordType} onChange={change('recordType')}>
            <MenuItem value="daily">سجل يومي</MenuItem>
            <MenuItem value="meterReset">تغيير عداد</MenuItem>
          </Select>
        </FormControl>

        <TextField
          type="number"
          label="القراءة السابقة"
          value={f.previousReading}
          onChange={change('previousReading')}
          disabled={!prevEditable}
          error={!!e.previousReading}
          helperText={
            e.previousReading ||
            (meter
              ? 'أدخل قراءة بداية العداد الجديد'
              : first
                ? 'أدخل قراءة البداية لأول سجل'
                : 'تُجلب من آخر قراءة تلقائيًا')
          }
        />

        <TextField
          type="number"
          label="القراءة الحالية"
          value={f.currentReading}
          onChange={change('currentReading')}
          error={!!e.currentReading}
          helperText={e.currentReading}
        />

        <TextField label="ساعات التشغيل" value={Number.isFinite(hours) ? hours : 0} disabled />

        <TextField
          label="الملاحظات"
          multiline
          minRows={2}
          inputProps={{ maxLength: 500 }}
          value={f.notes}
          onChange={change('notes')}
          error={!!e.notes}
          helperText={e.notes || `${f.notes.length}/500`}
        />

        <Button variant="contained" size="large" onClick={submit} disabled={blocked}>
          حفظ السجل
        </Button>
      </Stack>
    </Paper>
  );
}
