import { Box, Button, Card, CardContent, Stack, Typography } from '@mui/material';
import { DashboardRounded } from '@mui/icons-material';
import { Link } from 'react-router-dom';

export default function NotFound() {
  return (
    <Box sx={{ display: 'grid', placeItems: 'center', py: 8, px: 2 }}>
      <Card sx={{ maxWidth: 460, width: '100%', textAlign: 'center', borderRadius: 4 }}>
        <Box sx={{ height: 5, bgcolor: 'primary.main' }} />
        <CardContent sx={{ p: 4 }}>
          <Stack alignItems="center" spacing={1.5}>
            <Typography variant="h2" fontWeight={800} color="primary">
              404
            </Typography>
            <Typography variant="h6" fontWeight={700}>
              الصفحة غير موجودة
            </Typography>
            <Typography variant="body2" color="text.secondary" mb={1}>
              الرابط الذيطلبته غير متوفر أو تم نقله إلى قسم آخر.
            </Typography>
            <Button
              variant="contained"
              startIcon={<DashboardRounded />}
              component={Link}
              to="/"
            >
              العودة للوحة التحكم
            </Button>
          </Stack>
        </CardContent>
      </Card>
    </Box>
  );
}