import { useMemo, useState } from 'react';
import {
  Box,
  Button,
  Card,
  CardContent,
  Chip,
  FormControl,
  Grid,
  IconButton,
  InputLabel,
  MenuItem,
  Select,
  Stack,
  TextField,
  Typography,
} from '@mui/material';
import {
  AddRounded,
  EditRounded,
  PlaceRounded,
  StarBorderRounded,
  StarRounded,
} from '@mui/icons-material';
import { useApp } from '../context/AppContext';
import { PageTitle, StatusChip } from '../components/Common';
import GeneratorForm from '../components/GeneratorForm';
import { latestLog, totalHours } from '../utils/calculations';
import { niceDate } from '../utils/dates';

export const formatCoordinates = (lat, lng) => {
  const hasLat = lat !== undefined && lat !== null && String(lat).trim() !== '';
  const hasLng = lng !== undefined && lng !== null && String(lng).trim() !== '';
  if (!hasLat && !hasLng) return '—';
  return `${hasLat ? lat : '—'}, ${hasLng ? lng : '—'}`;
};

export default function Generators() {
  const { data, makeDefault } = useApp();
  const [open, setOpen] = useState(false);
  const [edit, setEdit] = useState(null);
  const [q, setQ] = useState('');
  const [status, setStatus] = useState('all');

  const list = useMemo(
    () =>
      data.generators.filter(g => {
        const text = [
          g.number,
          g.name,
          g.location,
          g.capacity,
          g.latitude,
          g.longitude,
          g.status === 'active' ? 'نشط' : 'غير نشط',
        ]
          .join(' ')
          .toLowerCase();
        return text.includes(q.toLowerCase()) && (status === 'all' || g.status === status);
      }),
    [data.generators, q, status]
  );

  return (
    <>
      <PageTitle
        title="المولدات"
        subtitle="تعريف المولدات وإدارة حالتها"
        action={
          <Button
            variant="contained"
            startIcon={<AddRounded />}
            onClick={() => {
              setEdit(null);
              setOpen(true);
            }}
          >
            إضافة مولد
          </Button>
        }
      />

      <Stack direction={{ xs: 'column', sm: 'row' }} spacing={2} mb={3}>
        <TextField
          fullWidth
          label="بحث في جميع حقول المولد"
          value={q}
          onChange={e => setQ(e.target.value)}
        />
        <FormControl sx={{ minWidth: 180 }}>
          <InputLabel>الحالة</InputLabel>
          <Select value={status} label="الحالة" onChange={e => setStatus(e.target.value)}>
            <MenuItem value="all">الكل</MenuItem>
            <MenuItem value="active">نشط</MenuItem>
            <MenuItem value="inactive">غير نشط</MenuItem>
          </Select>
        </FormControl>
      </Stack>

      <Grid container spacing={2}>
        {list.map(g => {
          const l = latestLog(data.logs, g.id);
          const hours = totalHours(data.logs.filter(x => x.generatorId === g.id));
          const coords = formatCoordinates(g.latitude, g.longitude);
          return (
            <Grid size={{ xs: 12, md: 6, lg: 4 }} key={g.id}>
              <Card sx={{ height: '100%' }}>
                <CardContent>
                  <Stack direction="row" justifyContent="space-between" alignItems="flex-start">
                    <Box>
                      <Typography variant="h6">{g.name}</Typography>
                      <Typography color="text.secondary">
                        {g.number} • {g.location}
                      </Typography>
                    </Box>
                    <IconButton
                      onClick={() => {
                        setEdit(g);
                        setOpen(true);
                      }}
                    >
                      <EditRounded />
                    </IconButton>
                  </Stack>

                  <Stack spacing={1.25} mt={2}>
                    <Stack
                      direction="row"
                      spacing={1}
                      alignItems="center"
                      flexWrap="wrap"
                      useFlexGap
                    >
                      <StatusChip active={g.status === 'active'} />
                      {g.isDefault ? (
                        <Chip
                          size="small"
                          color="secondary"
                          icon={<StarRounded />}
                          label="المولد الافتراضي"
                        />
                      ) : (
                        g.status === 'active' && (
                          <Button
                            size="small"
                            startIcon={<StarBorderRounded />}
                            onClick={() => makeDefault(g.id)}
                          >
                            تعيين كمولد افتراضي
                          </Button>
                        )
                      )}
                    </Stack>

                    <Box
                      sx={{
                        p: 1.5,
                        borderRadius: 2.5,
                        bgcolor: 'action.hover',
                        display: 'grid',
                        gridTemplateColumns: '1fr 1fr',
                        gap: 1,
                      }}
                    >
                      <Typography variant="body2">
                        القدرة: <b>{g.capacity !== '' && g.capacity != null ? g.capacity : '—'}</b>
                      </Typography>
                      <Typography variant="body2">
                        آخر قراءة: <b className="tabular-nums">{l?.currentReading ?? '—'}</b>
                      </Typography>
                      <Typography variant="body2">
                        إجمالي التشغيل: <b className="tabular-nums">{hours} ساعة</b>
                      </Typography>
                      <Typography variant="body2">آخر تشغيل: {niceDate(l?.date)}</Typography>
                    </Box>

                    <Typography
                      variant="body2"
                      color="text.secondary"
                      sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}
                    >
                      <PlaceRounded fontSize="small" color="primary" />
                      <span>الإحداثيات (عرض، طول):</span>
                      <b dir="ltr" className="tabular-nums">
                        {coords}
                      </b>
                    </Typography>
                  </Stack>
                </CardContent>
              </Card>
            </Grid>
          );
        })}
      </Grid>

      {!list.length && (
        <Typography textAlign="center" color="text.secondary" mt={6}>
          لا توجد نتائج مطابقة.
        </Typography>
      )}

      <GeneratorForm open={open} edit={edit} onClose={() => setOpen(false)} />
    </>
  );
}
