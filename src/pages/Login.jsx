import { useState } from 'react';
import {
  Alert,
  Box,
  Button,
  Card,
  CardContent,
  Chip,
  Stack,
  TextField,
  Typography,
} from '@mui/material';
import { alpha } from '@mui/material/styles';
import {
  LockRounded,
  PrecisionManufacturingRounded,
  VerifiedUserRounded,
} from '@mui/icons-material';
import { useAoms } from '../context/AomsContext';

export default function Login() {
  const { signIn, resetPassword } = useAoms();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [info, setInfo] = useState('');
  const [busy, setBusy] = useState(false);

  const submit = async e => {
    e.preventDefault();
    setBusy(true);
    setError('');
    setInfo('');
    try {
      await signIn(email, password);
    } catch (x) {
      setError(x.message || 'تعذر تسجيل الدخول');
    } finally {
      setBusy(false);
    }
  };

  const handleReset = async () => {
    if (!email.trim()) {
      setError('أدخل البريد الإلكتروني أولًا لإرسال رابط استعادة كلمة المرور');
      return;
    }
    setBusy(true);
    setError('');
    setInfo('');
    try {
      await resetPassword(email.trim());
      setInfo('تم إرسال رابط استعادة كلمة المرور إلى بريدك الإلكتروني');
    } catch (x) {
      setError(x.message || 'تعذر إرسال رابط استعادة كلمة المرور');
    } finally {
      setBusy(false);
    }
  };

  return (
    <Box
      sx={{
        minHeight: '100vh',
        display: 'grid',
        placeItems: 'center',
        p: 2,
        background: theme =>
          theme.palette.mode === 'dark'
            ? 'radial-gradient(circle at 80% 15%, rgba(20, 184, 166, 0.22) 0%, transparent 45%), radial-gradient(circle at 20% 85%, rgba(245, 158, 11, 0.14) 0%, transparent 45%), #060d18'
            : 'radial-gradient(circle at 80% 15%, rgba(15, 118, 110, 0.14) 0%, transparent 45%), radial-gradient(circle at 20% 85%, rgba(2, 132, 199, 0.12) 0%, transparent 45%), #f1f5f9',
      }}
    >
      <Card
        sx={{
          width: '100%',
          maxWidth: 460,
          overflow: 'hidden',
          borderRadius: 5,
          border: '1px solid',
          borderColor: theme => alpha(theme.palette.primary.main, 0.28),
          boxShadow: theme =>
            theme.palette.mode === 'dark'
              ? '0 24px 64px rgba(0, 0, 0, 0.65)'
              : '0 24px 60px rgba(15, 23, 42, 0.12)',
        }}
      >
        <Box
          sx={{
            p: 3.5,
            pb: 2.5,
            background: theme =>
              theme.palette.mode === 'dark'
                ? 'linear-gradient(135deg, rgba(20, 184, 166, 0.22) 0%, rgba(15, 26, 44, 0.95) 100%)'
                : 'linear-gradient(135deg, rgba(15, 118, 110, 0.12) 0%, rgba(240, 253, 250, 0.9) 100%)',
            borderBottom: '1px solid',
            borderColor: 'divider',
          }}
        >
          <Stack direction="row" justifyContent="space-between" alignItems="center" mb={1.5}>
            <Box
              sx={{
                width: 52,
                height: 52,
                borderRadius: 3.5,
                background: 'linear-gradient(135deg, #0f766e 0%, #14b8a6 100%)',
                color: '#fff',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                boxShadow: '0 8px 20px rgba(15, 118, 110, 0.35)',
              }}
            >
              <PrecisionManufacturingRounded fontSize="large" />
            </Box>
            <Chip
              size="small"
              color="primary"
              icon={<VerifiedUserRounded fontSize="small" />}
              label="بوابة موثقة ومحمية"
            />
          </Stack>
          <Typography
            variant="h5"
            mb={0.5}
            fontWeight={800}
            color="primary"
            sx={{ fontSize: { xs: '1.3rem', sm: '1.55rem' }, lineHeight: 1.3 }}
          >
            إدارة وتشغيل الأصول والمعدات
          </Typography>
          <Typography color="text.secondary" variant="body2">
            الدخول للمصرح لهم فقط
          </Typography>
        </Box>

        <CardContent component="form" onSubmit={submit} sx={{ p: 3.5 }}>
          {error && (
            <Alert severity="error" sx={{ mb: 2.5 }}>
              {error}
            </Alert>
          )}
          {info && (
            <Alert severity="success" sx={{ mb: 2.5 }}>
              {info}
            </Alert>
          )}
          <Stack spacing={2.25}>
            <TextField
              fullWidth
              label="البريد الإلكتروني"
              slotProps={{ inputLabel: { shrink: true } }}
              type="email"
              value={email}
              onChange={e => setEmail(e.target.value)}
              required
            />
            <TextField
              fullWidth
              label="كلمة المرور"
              slotProps={{ inputLabel: { shrink: true } }}
              type="password"
              value={password}
              onChange={e => setPassword(e.target.value)}
              required
            />
            <Button
              fullWidth
              type="submit"
              variant="contained"
              size="large"
              startIcon={<LockRounded />}
              disabled={busy}
              sx={{ py: 1.4, mt: 0.5 }}
            >
              {busy ? 'جارٍ التحقق…' : 'تسجيل الدخول'}
            </Button>
            <Button fullWidth variant="text" size="small" onClick={handleReset} disabled={busy}>
              نسيت كلمة المرور؟ استعادة عبر البريد
            </Button>
          </Stack>
        </CardContent>
      </Card>
    </Box>
  );
}
