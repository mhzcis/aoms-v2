import { Alert, Box, Card, CardContent, Chip, Stack, Typography } from '@mui/material';
import { SettingsRounded, WarningAmberRounded } from '@mui/icons-material';

export default function SetupRequired() {
  return (
    <Box
      sx={{
        minHeight: '100vh',
        display: 'grid',
        placeItems: 'center',
        p: 3,
      }}
    >
      <Card sx={{ maxWidth: 680, width: '100%', borderRadius: 4 }}>
        <Box sx={{ height: 6, bgcolor: 'warning.main' }} />
        <CardContent sx={{ p: 4 }}>
          <Stack direction="row" spacing={1.5} alignItems="center" mb={2}>
            <SettingsRounded color="warning" fontSize="large" />
            <Typography variant="h4" fontWeight={800}>
              إعداد الاتصال مطلوب
            </Typography>
            <Chip size="small" color="warning" icon={<WarningAmberRounded />} label="تهيئة البيئة" />
          </Stack>
          <Alert severity="warning" sx={{ mb: 2 }}>
            اضبط VITE_SUPABASE_URL وVITE_SUPABASE_ANON_KEY في أسرار بيئة البناء، ثم شغّل ترحيلات Supabase بالترتيب الموثق في README.
          </Alert>
          <Typography variant="body2" color="text.secondary">
            يعمل التطبيق في بيئة الإنتاج مع قاعدة بيانات Supabase المفعّلة بسياسات أمان الصفوف (RLS) والدوال المخزنة الذرية.
          </Typography>
        </CardContent>
      </Card>
    </Box>
  );
}
