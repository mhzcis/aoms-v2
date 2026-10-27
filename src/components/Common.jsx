import {
  Alert,
  Box,
  Button,
  Card,
  CardContent,
  Chip,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  Snackbar,
  TextField,
  Typography,
} from '@mui/material';
import { alpha } from '@mui/material/styles';
import { Component, useEffect, useRef, useState } from 'react';
import { useApp } from '../context/AppContext';
import { isWipeConfirmed, WIPE_CONFIRM_WORD } from '../services/backupService';

export class ErrorBoundary extends Component {
  constructor(props) {
    super(props);
    this.state = { hasError: false };
  }
  static getDerivedStateFromError() {
    return { hasError: true };
  }
  render() {
    if (this.state.hasError) {
      return (
        <Box sx={{ p: 4, textAlign: 'center', mt: 8 }}>
          <Typography variant="h5" color="error" gutterBottom>
            حدث خطأ غير متوقع أثناء عرض الواجهة
          </Typography>
          <Typography color="text.secondary" mb={3}>
            بياناتك المحلية محفوظة في المتصفح. يمكنك إعادة تحميل الصفحة للمتابعة.
          </Typography>
          <Button variant="contained" onClick={() => window.location.reload()}>
            إعادة تحميل التطبيق
          </Button>
        </Box>
      );
    }
    return this.props.children;
  }
}

export const PageTitle = ({ title, subtitle, action }) => (
  <Box
    sx={{
      display: 'flex',
      justifyContent: 'space-between',
      alignItems: 'center',
      mb: 3,
      gap: 2,
      flexWrap: 'wrap',
    }}
  >
    <Box>
      <Typography variant="h4">{title}</Typography>
      <Typography color="text.secondary" sx={{ mt: 0.5 }}>
        {subtitle}
      </Typography>
    </Box>
    {action}
  </Box>
);

export const StatCard = ({ title, value, icon, color = 'primary.main' }) => (
  <Card sx={{ position: 'relative', overflow: 'hidden', height: '100%' }}>
    <Box sx={{ height: 4, bgcolor: color, width: '100%' }} />
    <CardContent sx={{ p: 2.5 }}>
      <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 1.5 }}>
        <Box>
          <Typography color="text.secondary" fontWeight={600} variant="body2">
            {title}
          </Typography>
          <Typography variant="h4" sx={{ mt: 1, fontVariantNumeric: 'tabular-nums' }}>
            {value}
          </Typography>
        </Box>
        <Box
          sx={{
            color,
            fontSize: 32,
            width: 52,
            height: 52,
            borderRadius: 3.5,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            bgcolor: theme =>
              color === 'secondary.main'
                ? alpha(theme.palette.secondary.main, 0.14)
                : alpha(theme.palette.primary.main, 0.12),
            flexShrink: 0,
          }}
        >
          {icon}
        </Box>
      </Box>
    </CardContent>
  </Card>
);

export const StatusChip = ({ active }) => (
  <Chip size="small" color={active ? 'success' : 'default'} label={active ? 'نشط' : 'غير نشط'} />
);

export function Confirm({ open, title, text, onYes, onClose }) {
  return (
    <Dialog open={open} onClose={onClose}>
      <DialogTitle>{title}</DialogTitle>
      <DialogContent>
        <Typography>{text}</Typography>
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose}>إلغاء</Button>
        <Button color="error" variant="contained" onClick={onYes}>
          تأكيد
        </Button>
      </DialogActions>
    </Dialog>
  );
}

export function Notices() {
  const { notice, setNotice } = useApp();
  return (
    <Snackbar
      key={notice?.text}
      open={!!notice}
      autoHideDuration={4000}
      // تجاهل النقر خارج الرسالة حتى لا تُغلق الرسالة الجديدة الناتجة عن النقر نفسه
      onClose={(_, reason) => reason !== 'clickaway' && setNotice(null)}
    >
      <Alert severity={notice?.type || 'info'} variant="filled">
        {notice?.text}
      </Alert>
    </Snackbar>
  );
}

export function WipeDialog({ open, onClose }) {
  const { wipeAll, manualBackup } = useApp();
  const [text, setText] = useState('');

  useEffect(() => {
    if (open) setText('');
  }, [open]);

  const ok = isWipeConfirmed(text);

  return (
    <Dialog open={open} onClose={onClose} fullWidth maxWidth="xs">
      <DialogTitle color="error">مسح شامل لجميع البيانات</DialogTitle>
      <DialogContent>
        <Alert severity="error" sx={{ mb: 2 }}>
          سيتم حذف جميع المولدات وسجلات التشغيل نهائيًا من هذا المتصفح، ولا يمكن التراجع عن ذلك.
        </Alert>
        <Typography mb={2}>
          يُنصح بتنزيل نسخة احتياطية قبل المسح. سيُنزّل التطبيق نسخة أمان تلقائيًا قبل التنفيذ.
        </Typography>
        <TextField
          fullWidth
          autoFocus
          label={`اكتب «${WIPE_CONFIRM_WORD}» للتأكيد`}
          value={text}
          onChange={e => setText(e.target.value)}
        />
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose}>إلغاء</Button>
        <Button onClick={manualBackup}>نسخة احتياطية</Button>
        <Button
          color="error"
          variant="contained"
          disabled={!ok}
          onClick={() => {
            if (ok && wipeAll()) onClose();
          }}
        >
          مسح نهائي
        </Button>
      </DialogActions>
    </Dialog>
  );
}

// تنبيه البيانات التالفة: لا تُحذف البيانات ولا يُكتب فوقها حتى يختار المستخدم أحد الخيارات.
export function CorruptDataDialog() {
  const { corrupt, downloadCorrupt, startFresh, restore } = useApp();
  const file = useRef(null);
  if (!corrupt) return null;
  return (
    <Dialog open disableEscapeKeyDown fullWidth maxWidth="sm" aria-labelledby="corrupt-title">
      <DialogTitle id="corrupt-title" color="warning.main">
        تعذّرت قراءة البيانات المحفوظة
      </DialogTitle>
      <DialogContent>
        <Alert severity="warning" sx={{ mb: 2 }}>
          البيانات المحفوظة في هذا المتصفح تالفة أو بصيغة غير معروفة، ولم يتم حذفها أو الكتابة فوقها.
        </Alert>
        <Typography mb={1}>
          {corrupt.key ? (
            <>
              حُفظت نسخة منها كما هي داخل المتصفح باسم «<bdi dir="ltr">{corrupt.key}</bdi>».
            </>
          ) : (
            'تعذر حفظ نسخة منها داخل المتصفح، لذا يُنصح بتنزيلها قبل المتابعة.'
          )}
        </Typography>
        <Typography color="text.secondary">
          اختر طريقة المتابعة: تنزيل البيانات التالفة لمراجعتها، أو الاستعادة من نسخة احتياطية، أو البدء من جديد.
        </Typography>
        <input
          hidden
          type="file"
          accept="application/json"
          ref={file}
          data-testid="corrupt-restore-input"
          onChange={e => {
            const f = e.target.files?.[0];
            e.target.value = '';
            if (f) restore(f);
          }}
        />
      </DialogContent>
      <DialogActions sx={{ flexWrap: 'wrap', gap: 1 }}>
        <Button onClick={downloadCorrupt}>تنزيل البيانات التالفة</Button>
        <Button variant="outlined" onClick={() => file.current?.click()}>
          استعادة من نسخة احتياطية
        </Button>
        <Button color="warning" variant="contained" onClick={startFresh}>
          البدء من جديد
        </Button>
      </DialogActions>
    </Dialog>
  );
}
