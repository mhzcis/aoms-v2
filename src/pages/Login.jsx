import { useState } from 'react';
import {
  Alert,
  Box,
  Button,
  Card,
  CardContent,
  Stack,
  TextField,
  Typography,
} from '@mui/material';
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
    <Box sx={{ minHeight: '100vh', display: 'grid', placeItems: 'center', p: 2 }}>
      <Card sx={{ width: '100%', maxWidth: 440 }}>
        <CardContent component="form" onSubmit={submit} sx={{ p: 4 }}>
          <Typography variant="h4" mb={1} fontWeight={800} color="primary">
            AOMS V2
          </Typography>
          <Typography color="text.secondary" mb={3}>
            نظام إدارة وتشغيل الأصول والمعدات (الدخول للمصرح لهم فقط)
          </Typography>
          {error && (
            <Alert severity="error" sx={{ mb: 2 }}>
              {error}
            </Alert>
          )}
          {info && (
            <Alert severity="success" sx={{ mb: 2 }}>
              {info}
            </Alert>
          )}
          <TextField
            fullWidth
            label="البريد الإلكتروني"
            type="email"
            value={email}
            onChange={e => setEmail(e.target.value)}
            sx={{ mb: 2 }}
            required
          />
          <TextField
            fullWidth
            label="كلمة المرور"
            type="password"
            value={password}
            onChange={e => setPassword(e.target.value)}
            sx={{ mb: 3 }}
            required
          />
          <Stack spacing={1.5}>
            <Button fullWidth type="submit" variant="contained" size="large" disabled={busy}>
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
