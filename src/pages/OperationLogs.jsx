import TextField from '../components/AppTextField';
import { useEffect, useMemo, useRef, useState } from 'react';
import {
  Box,
  Button,
  Chip,
  Collapse,
  FormControl,
  Grid,
  IconButton,
  InputLabel,
  MenuItem,
  Paper,
  Select,
  Stack,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TablePagination,
  TableRow,
  Tooltip,
  Typography,
} from '@mui/material';
import { alpha } from '@mui/material/styles';
import {
  AddRounded,
  DeleteRounded,
  EditRounded,
  FilterAltOffRounded,
  FilterListRounded,
  RestoreRounded,
} from '@mui/icons-material';
import { useSearchParams } from 'react-router-dom';
import { useApp } from '../context/AppContext';
import { Confirm, PageTitle } from '../components/Common';
import LogForm from '../components/LogForm';
import ReportActions from '../components/ReportActions';
import { describeFilters, filterLogs } from '../services/reportService';
import { latestLog } from '../utils/calculations';
import { niceDate } from '../utils/dates';

const init = {
  q: '',
  from: '',
  to: '',
  day: 'all',
  generator: 'all',
  type: 'all',
  prev: '',
  current: '',
  hours: '',
};

// شارة حالة السجل بنمط موحّد: «أصلي» بلون أخضر مزرق هادئ و«معدّل» بلون كهرماني، بتباين جيد في الوضعين.
const statusChipSx = kind => theme => {
  const dark = theme.palette.mode === 'dark';
  const c =
    kind === 'edited'
      ? dark
        ? { bg: 'rgba(245, 158, 11, 0.18)', fg: '#fcd34d', bd: 'rgba(245, 158, 11, 0.45)' }
        : { bg: '#fef3c7', fg: '#92400e', bd: '#fcd34d' }
      : dark
        ? { bg: 'rgba(20, 184, 166, 0.16)', fg: '#5eead4', bd: 'rgba(20, 184, 166, 0.4)' }
        : { bg: '#ccfbf1', fg: '#115e59', bd: '#5eead4' };
  return { bgcolor: c.bg, color: c.fg, border: '1px solid', borderColor: c.bd, fontWeight: 700 };
};

// تسميات عربية لأزرار التنقل بين الصفحات (aria-label والتلميح).
export const paginationAriaLabel = type =>
  ({
    first: 'الصفحة الأولى',
    last: 'الصفحة الأخيرة',
    next: 'الصفحة التالية',
    previous: 'الصفحة السابقة',
  })[type] || type;

export default function OperationLogs() {
  const { data, deleteLog, restore } = useApp();
  const [params, setParams] = useSearchParams();
  const [preset, setPreset] = useState(() =>
    params.get('new') === '1' ? params.get('generator') : null
  );
  const [formOpen, setFormOpen] = useState(!!preset);
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [edit, setEdit] = useState(null);
  const [filters, setFilters] = useState({
    ...init,
    generator: params.get('generator') || 'all',
  });
  const [highlight, setHighlight] = useState(null);
  const [confirm, setConfirm] = useState(null);
  const [page, setPage] = useState(0);
  const [rowsPerPage, setRowsPerPage] = useState(25);
  const file = useRef();

  useEffect(() => {
    const genParam = params.get('generator');
    const isNew = params.get('new') === '1';
    if (genParam) {
      setFilters(prev => ({ ...prev, generator: genParam }));
      if (isNew) {
        setPreset(genParam);
        setEdit(null);
        setFormOpen(true);
      }
    }
  }, [params]);

  useEffect(() => {
    if (highlight) {
      const t = setTimeout(() => setHighlight(null), 4000);
      return () => clearTimeout(t);
    }
  }, [highlight]);

  const set = k => e => {
    setPage(0);
    setFilters({ ...filters, [k]: e.target.value });
  };

  const resetFilters = () => {
    setPage(0);
    setFilters(init);
    if (params.toString()) setParams({}, { replace: true });
  };

  const logs = useMemo(
    () => filterLogs(data.logs, data.generators, filters),
    [data, filters]
  );

  const activeFiltersCount = useMemo(
    () =>
      Object.entries(filters).filter(([k, v]) => init[k] !== v && v !== '' && v !== 'all').length,
    [filters]
  );

  const filterText = describeFilters(filters, data.generators);

  const done = id => {
    setFormOpen(false);
    setEdit(null);
    setPreset(null);
    setHighlight(id);
    setPage(0);
    setFilters(init);
    if (params.toString()) setParams({}, { replace: true });
    setTimeout(
      () => document.getElementById(`log-${id}`)?.scrollIntoView({ behavior: 'smooth', block: 'center' }),
      100
    );
  };

  const visibleLogs =
    logs.length > rowsPerPage
      ? logs.slice(page * rowsPerPage, page * rowsPerPage + rowsPerPage)
      : logs;

  return (
    <>
      <PageTitle
        title="سجل التشغيل"
        subtitle="سجل واحد يوميًا لكل مولد"
        action={
          <Stack direction="row" spacing={1} flexWrap="wrap" useFlexGap>
            <input
              hidden
              type="file"
              accept="application/json"
              ref={file}
              onChange={e => {
                const selectedFile = e.target.files?.[0];
                e.target.value = '';
                if (selectedFile) restore(selectedFile);
              }}
            />
            <Button
              variant="outlined"
              startIcon={<FilterListRounded />}
              onClick={() => setFiltersOpen(x => !x)}
            >
              {filtersOpen ? 'إخفاء الفلاتر' : 'إظهار الفلاتر'}
              {activeFiltersCount > 0 ? ` (${activeFiltersCount})` : ''}
            </Button>
            <Button
              variant="outlined"
              startIcon={<RestoreRounded />}
              onClick={() => file.current.click()}
            >
              استعادة
            </Button>
            <Button
              variant="contained"
              startIcon={<AddRounded />}
              onClick={() => {
                setEdit(null);
                setPreset(null);
                setFormOpen(x => !x);
              }}
            >
              سجل جديد
            </Button>
          </Stack>
        }
      />

      <Collapse in={formOpen}>
        <Box mb={3}>
          <LogForm edit={edit} onDone={done} open={formOpen} preset={preset} />
        </Box>
      </Collapse>

      <Collapse in={filtersOpen}>
        <Paper sx={{ p: 2, mb: 2 }}>
          <Grid container spacing={2}>
            <Grid size={{ xs: 12, md: 4 }}>
              <TextField
                fullWidth
                label="بحث شامل"
                value={filters.q}
                onChange={set('q')}
              />
            </Grid>
            <Grid size={{ xs: 6, md: 2 }}>
              <TextField
                fullWidth
                type="date"
                label="من"
                InputLabelProps={{ shrink: true }}
                value={filters.from}
                onChange={set('from')}
              />
            </Grid>
            <Grid size={{ xs: 6, md: 2 }}>
              <TextField
                fullWidth
                type="date"
                label="إلى"
                InputLabelProps={{ shrink: true }}
                value={filters.to}
                onChange={set('to')}
              />
            </Grid>
            <Grid size={{ xs: 12, md: 4 }}>
              <FormControl fullWidth>
                <InputLabel>المولد</InputLabel>
                <Select label="المولد" value={filters.generator} onChange={set('generator')}>
                  <MenuItem value="all">كل المولدات</MenuItem>
                  {data.generators.map(g => (
                    <MenuItem key={g.id} value={g.id}>
                      {g.number} | {g.name}
                    </MenuItem>
                  ))}
                </Select>
              </FormControl>
            </Grid>
            <Grid size={{ xs: 6, md: 2 }}>
              <FormControl fullWidth>
                <InputLabel>نوع السجل</InputLabel>
                <Select label="نوع السجل" value={filters.type} onChange={set('type')}>
                  <MenuItem value="all">الكل</MenuItem>
                  <MenuItem value="daily">سجل يومي</MenuItem>
                  <MenuItem value="meterReset">تغيير عداد</MenuItem>
                </Select>
              </FormControl>
            </Grid>
            <Grid size={{ xs: 6, md: 2 }}>
              <FormControl fullWidth>
                <InputLabel>اليوم</InputLabel>
                <Select label="اليوم" value={filters.day} onChange={set('day')}>
                  <MenuItem value="all">كل الأيام</MenuItem>
                  {['السبت', 'الأحد', 'الاثنين', 'الثلاثاء', 'الأربعاء', 'الخميس', 'الجمعة'].map(x => (
                    <MenuItem value={x} key={x}>
                      {x}
                    </MenuItem>
                  ))}
                </Select>
              </FormControl>
            </Grid>
            {[
              ['prev', 'القراءة السابقة'],
              ['current', 'القراءة الحالية'],
              ['hours', 'ساعات التشغيل'],
            ].map(([k, l]) => (
              <Grid size={{ xs: 6, md: 2 }} key={k}>
                <TextField
                  fullWidth
                  type="number"
                  label={l}
                  value={filters[k]}
                  onChange={set(k)}
                />
              </Grid>
            ))}
            <Grid size={{ xs: 12, md: 2 }}>
              <Button
                fullWidth
                sx={{ height: '100%' }}
                startIcon={<FilterAltOffRounded />}
                onClick={resetFilters}
              >
                مسح الفلاتر
              </Button>
            </Grid>
          </Grid>
        </Paper>
      </Collapse>

      <Stack direction="row" justifyContent="space-between" alignItems="center" mb={2}>
        <Typography fontWeight={600}>{logs.length} سجل</Typography>
        <ReportActions logs={logs} generators={data.generators} filtersText={filterText} />
      </Stack>

      <TableContainer component={Paper} sx={{ maxHeight: 640 }}>
        <Table size="small" stickyHeader>
          <TableHead>
            <TableRow>
              {[
                'التاريخ',
                'اليوم',
                'المولد',
                'النوع',
                'السابقة',
                'الحالية',
                'الساعات',
                'الملاحظات',
                'الحالة',
                'إجراءات',
              ].map(x => (
                <TableCell key={x}>{x}</TableCell>
              ))}
            </TableRow>
          </TableHead>
          <TableBody>
            {visibleLogs.map(x => {
              const g = data.generators.find(y => y.id === x.generatorId);
              const isLast = latestLog(data.logs, x.generatorId)?.id === x.id;
              return (
                <TableRow
                  hover
                  id={`log-${x.id}`}
                  key={x.id}
                  sx={{
                    bgcolor: theme =>
                      highlight === x.id
                        ? alpha(
                            theme.palette.success.main,
                            theme.palette.mode === 'dark' ? 0.24 : 0.14
                          )
                        : 'inherit',
                    transition: 'background-color 1s ease',
                  }}
                >
                  <TableCell className="tabular-nums">{niceDate(x.date)}</TableCell>
                  <TableCell>{x.day}</TableCell>
                  <TableCell>
                    {g?.number} | {g?.name}
                  </TableCell>
                  <TableCell>
                    <Chip
                      size="small"
                      color={x.recordType === 'meterReset' ? 'warning' : 'primary'}
                      label={x.recordType === 'daily' ? 'سجل يومي' : 'تغيير عداد'}
                    />
                  </TableCell>
                  <TableCell className="tabular-nums">{x.previousReading}</TableCell>
                  <TableCell className="tabular-nums">{x.currentReading}</TableCell>
                  <TableCell className="tabular-nums">
                    <b>{x.operatingHours}</b>
                  </TableCell>
                  <TableCell>{x.notes || '—'}</TableCell>
                  <TableCell>
                    {x.edited ? (
                      <Tooltip title={new Date(x.updatedAt).toLocaleString('ar')}>
                        <Chip size="small" label="معدّل" sx={statusChipSx('edited')} />
                      </Tooltip>
                    ) : (
                      <Chip size="small" label="أصلي" sx={statusChipSx('original')} />
                    )}
                  </TableCell>
                  <TableCell>
                    {isLast ? (
                      <>
                        <IconButton
                          size="small"
                          onClick={() => {
                            setEdit(x);
                            setFormOpen(true);
                            scrollTo({ top: 0, behavior: 'smooth' });
                          }}
                        >
                          <EditRounded />
                        </IconButton>
                        <IconButton size="small" color="error" onClick={() => setConfirm(x.id)}>
                          <DeleteRounded />
                        </IconButton>
                      </>
                    ) : (
                      <Tooltip title="مقفل لوجود سجل أحدث">
                        <span>🔒</span>
                      </Tooltip>
                    )}
                  </TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
        {logs.length > rowsPerPage && (
          <TablePagination
            component="div"
            count={logs.length}
            page={page}
            onPageChange={(_, newPage) => setPage(newPage)}
            rowsPerPage={rowsPerPage}
            onRowsPerPageChange={e => {
              setRowsPerPage(parseInt(e.target.value, 10));
              setPage(0);
            }}
            rowsPerPageOptions={[10, 25, 50, 100]}
            labelRowsPerPage="عدد السجلات في الصفحة:"
            labelDisplayedRows={({ from, to, count }) => `${from}–${to} من ${count}`}
            getItemAriaLabel={paginationAriaLabel}
          />
        )}
      </TableContainer>

      {!logs.length && (
        <Typography textAlign="center" color="text.secondary" p={5}>
          لا توجد سجلات مطابقة.
        </Typography>
      )}

      <Confirm
        open={!!confirm}
        title="حذف آخر سجل"
        text="هل تريد حذف السجل؟ سيتم تنزيل نسخة احتياطية تلقائيًا."
        onClose={() => setConfirm(null)}
        onYes={() => {
          deleteLog(confirm);
          setConfirm(null);
        }}
      />
    </>
  );
}
