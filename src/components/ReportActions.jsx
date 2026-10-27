import { useMemo, useState } from 'react';
import {
  Button,
  Checkbox,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  FormControlLabel,
  FormGroup,
  FormLabel,
  Radio,
  RadioGroup,
  Stack,
} from '@mui/material';
import { FileDownloadRounded, PictureAsPdfRounded, PrintRounded } from '@mui/icons-material';
import { useApp } from '../context/AppContext';
import {
  enrich,
  exportCSV,
  exportExcel,
  exportPDF,
  orderReportData,
  REPORT_ORDERS,
  reportLabels,
} from '../services/reportService';

const defaults = [
  'date',
  'day',
  'generatorNumber',
  'generatorName',
  'previousReading',
  'currentReading',
  'operatingHours',
  'recordTypeLabel',
  'notes',
];

export default function ReportActions({ logs, generators, filtersText }) {
  const [open, setOpen] = useState(false);
  const [cols, setCols] = useState(defaults);
  const [order, setOrder] = useState('newest');
  const { setNotice } = useApp() || {};
  const data = useMemo(
    () => orderReportData(enrich(logs, generators), order),
    [logs, generators, order]
  );

  const toggle = c => setCols(x => (x.includes(c) ? x.filter(y => y !== c) : [...x, c]));

  const handlePrintOrPDF = () => {
    const ok = exportPDF(data, cols, 'تقرير تشغيل المولدات', filtersText);
    if (!ok) {
      setNotice?.({
        type: 'error',
        text: 'تعذر فتح نافذة التقرير. يرجى السماح بالنوافذ المنبثقة لهذا الموقع.',
      });
    }
  };

  return (
    <>
      <Stack direction="row" spacing={1}>
        <Button startIcon={<FileDownloadRounded />} variant="outlined" onClick={() => setOpen(true)}>
          تصدير
        </Button>
        <Button startIcon={<PrintRounded />} variant="outlined" onClick={handlePrintOrPDF}>
          طباعة / PDF
        </Button>
      </Stack>
      <Dialog open={open} onClose={() => setOpen(false)}>
        <DialogTitle>اختيار أعمدة التقرير</DialogTitle>
        <DialogContent>
          <FormGroup>
            {Object.entries(reportLabels).map(([k, v]) => (
              <FormControlLabel
                key={k}
                control={<Checkbox checked={cols.includes(k)} onChange={() => toggle(k)} />}
                label={v}
              />
            ))}
          </FormGroup>
          <FormLabel id="report-order-label" sx={{ mt: 2, display: 'block', fontWeight: 700 }}>
            ترتيب السجلات
          </FormLabel>
          <RadioGroup
            row
            aria-labelledby="report-order-label"
            name="report-order"
            value={order}
            onChange={e => setOrder(e.target.value)}
          >
            {Object.entries(REPORT_ORDERS).map(([k, v]) => (
              <FormControlLabel key={k} value={k} control={<Radio />} label={v} />
            ))}
          </RadioGroup>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => exportCSV(data, cols, 'تقرير-التشغيل')} disabled={!cols.length}>
            CSV
          </Button>
          <Button
            color="secondary"
            variant="outlined"
            startIcon={<PictureAsPdfRounded />}
            onClick={handlePrintOrPDF}
            disabled={!cols.length}
          >
            PDF
          </Button>
          <Button
            variant="contained"
            onClick={() => exportExcel(data, cols, 'تقرير-التشغيل', filtersText)}
            disabled={!cols.length}
          >
            Excel
          </Button>
        </DialogActions>
      </Dialog>
    </>
  );
}
