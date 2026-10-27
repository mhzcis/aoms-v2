import { Button, Stack, Typography } from '@mui/material';
import { Link } from 'react-router-dom';

export default () => (
  <Stack alignItems="center" mt={10} spacing={1.5}>
    <Typography variant="h2" fontWeight={800} color="primary">
      404
    </Typography>
    <Typography color="text.secondary">الصفحة غير موجودة</Typography>
    <Button variant="contained" component={Link} to="/">
      العودة للوحة التحكم
    </Button>
  </Stack>
);