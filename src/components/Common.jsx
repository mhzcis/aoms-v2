import TextField from './AppTextField';
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

export const PageTitle = ({ title, subtitle, action, badge }) => (
  <Box
    sx={{
      display: 'flex',
      justifyContent: 'space-between',
      alignItems: 'center',
      mb: 3,
      p: { xs: 2, md: 2.5 },
      borderRadius: 4,
      background: theme =>
        theme.palette.mode === 'dark'
          ? 'linear-gradient(135deg, rgba(20, 184, 166, 0.14) 0%, rgba(15, 26, 44, 0.9) 100%)'
          : 'linear-gradient(135deg, rgba(15, 118, 110, 0.08) 0%, rgba(255, 255, 255, 0.95) 100%)',
      border: '1px solid',
      borderColor: theme => alpha(theme.palette.primary.main, 0.2),
      gap: 2,
      flexWrap: 'wrap',
    }}
  >
    <Box sx={{ minWidth: 0 }}>
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.25, flexWrap: 'wrap' }}>
        <Typography variant="h4" sx={{ fontWeight: 800, fontSize: { xs: '1.45rem', md: '1.85rem' } }}>
          {title}
        </Typography>
        {badge}
      </Box>
      {subtitle && (
        <Typography color="text.secondary" sx={{ mt: 0.5, fontSize: { xs: '0.88rem', md: '0.96rem' } }}>
          {subtitle}
        </Typography>
      )}
    </Box>
    {action}
  </Box>
);

export const StatCard = ({ title, value, subtitle, icon, color = 'primary.main' }) => {
  const resolveTone = theme => {
    if (color === 'secondary.main' || color === 'warning.main') return theme.palette.secondary.main;
    if (color === 'info.main') return theme.palette.info.main;
    if (color === 'success.main') return theme.palette.success.main;
    if (color === 'error.main') return theme.palette.error.main;
    return theme.palette.primary.main;
  };

  return (
    <Card
      sx={{
        position: 'relative',
        overflow: 'hidden',
        height: '100%',
        background: theme =>
          theme.palette.mode === 'dark'
            ? `linear-gradient(145deg, ${alpha(resolveTone(theme), 0.14)} 0%, ${theme.palette.background.paper} 65%)`
            : `linear-gradient(145deg, ${alpha(resolveTone(theme), 0.07)} 0%, #ffffff 65%)`,
        borderColor: theme => alpha(resolveTone(theme), 0.24),
      }}
    >
      <Box
        sx={{
          height: 5,
          bgcolor: color,
          width: '100%',
        }}
      />
      <CardContent sx={{ p: 2.5 }}>
        <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 1.5 }}>
          <Box sx={{ minWidth: 0 }}>
            <Typography color="text.secondary" fontWeight={700} variant="body2">
              {title}
            </Typography>
            <Typography
              variant="h4"
              sx={{
                mt: 1,
                fontWeight: 800,
                fontVariantNumeric: 'tabular-nums',
                fontSize: { xs: '1.55rem', md: '1.85rem' },
              }}
            >
              {value}
            </Typography>
            {subtitle && (
              <Typography variant="caption" color="text.secondary" sx={{ mt: 0.5, display: 'block' }}>
                {subtitle}
              </Typography>
            )}
          </Box>
          <Box
            sx={{
              color,
              fontSize: 30,
              width: 54,
              height: 54,
              borderRadius: 3.5,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              bgcolor: theme => alpha(resolveTone(theme), theme.palette.mode === 'dark' ? 0.22 : 0.14),
              border: '1px solid',
              borderColor: theme => alpha(resolveTone(theme), 0.28),
              flexShrink: 0,
            }}
          >
            {icon}
          </Box>
        </Box>
      </CardContent>
    </Card>
  );
};

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
