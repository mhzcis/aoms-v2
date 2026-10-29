import TextField from './AppTextField';
import { useEffect, useState } from 'react';
import {
  Button,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  FormControl,
  InputLabel,
  MenuItem,
  Select,
  Stack,
  } from '@mui/material';
import { useApp } from '../context/AppContext';

const blank = {
  number: '',
  name: '',
  location: '',
  capacity: '',
  latitude: '',
  longitude: '',
  status: 'active',
};

export default function GeneratorForm({ open, onClose, edit }) {
  const { addGenerator, updateGenerator } = useApp();
  const [f, setF] = useState(blank);
  const [e, setE] = useState({});

  useEffect(() => {
    setF(edit ? { ...blank, ...edit } : blank);
    setE({});
  }, [edit, open]);

  const change = k => x => setF({ ...f, [k]: x.target.value });

  const submit = () => {
    const x = edit ? updateGenerator(f) : addGenerator(f);
    setE(x);
    if (!Object.keys(x).length) onClose();
  };

  return (
    <Dialog open={open} onClose={onClose} fullWidth maxWidth="sm">
      <DialogTitle>{edit ? 'تعديل مولد' : 'إضافة مولد'}</DialogTitle>
      <DialogContent>
        <Stack spacing={2} mt={1}>
          <TextField
            label="رقم المولد"
            value={f.number}
            onChange={change('number')}
            error={!!e.number}
            helperText={e.number}
          />
          <TextField
            label="اسم المولد"
            value={f.name}
            onChange={change('name')}
            error={!!e.name}
            helperText={e.name}
          />
          <TextField
            label="الموقع"
            value={f.location}
            onChange={change('location')}
            error={!!e.location}
            helperText={e.location}
          />
          <TextField
            label="القدرة (اختياري)"
            type="number"
            value={f.capacity}
            onChange={change('capacity')}
            error={!!e.capacity}
            helperText={e.capacity}
          />
          <Stack direction={{ xs: 'column', sm: 'row' }} spacing={2}>
            <TextField
              fullWidth
              label="إحداثيات العرض (اختياري)"
              type="number"
              inputProps={{ step: 'any', min: -90, max: 90 }}
              value={f.latitude}
              onChange={change('latitude')}
              error={!!e.latitude}
              helperText={e.latitude || 'بين -90 و 90'}
            />
            <TextField
              fullWidth
              label="إحداثيات الطول (اختياري)"
              type="number"
              inputProps={{ step: 'any', min: -180, max: 180 }}
              value={f.longitude}
              onChange={change('longitude')}
              error={!!e.longitude}
              helperText={e.longitude || 'بين -180 و 180'}
            />
          </Stack>
          <FormControl>
            <InputLabel>الحالة</InputLabel>
            <Select label="الحالة" value={f.status} onChange={change('status')}>
              <MenuItem value="active">نشط</MenuItem>
              <MenuItem value="inactive">غير نشط</MenuItem>
            </Select>
          </FormControl>
        </Stack>
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose}>إلغاء</Button>
        <Button variant="contained" onClick={submit}>
          حفظ
        </Button>
      </DialogActions>
    </Dialog>
  );
}
