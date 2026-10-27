import { Box, Card, CardContent, Chip, Grid, Stack, Typography } from '@mui/material';
import {
  AccessTimeRounded,
  CalendarMonthRounded,
  ElectricalServicesRounded,
  EmojiEventsRounded,
} from '@mui/icons-material';
import { useNavigate } from 'react-router-dom';
import { useApp } from '../context/AppContext';
import { PageTitle, StatCard } from '../components/Common';
import { DailyChart, MonthlyChart } from '../components/Charts';
import {
  dailyChart,
  dashboardStats,
  latestLog,
  monthlyByGenerator,
  sortLogs,
} from '../utils/calculations';
import { noLogsLink } from '../utils/logForm';
import { niceDate } from '../utils/dates';

export default function Dashboard() {
  const { data } = useApp();
  const nav = useNavigate();
  const s = dashboardStats(data.generators, data.logs);
  const noLogs = data.generators.filter(g => !latestLog(data.logs, g.id));

  return (
    <>
      <PageTitle title="لوحة التحكم" subtitle="نظرة شاملة على أداء المولدات" />

      <Grid container spacing={2}>
        <Grid size={{ xs: 12, sm: 6, lg: 3 }}>
          <StatCard
            title="المولدات"
            value={`${s.active} نشط / ${s.count}`}
            icon={<ElectricalServicesRounded fontSize="inherit" />}
          />
        </Grid>
        <Grid size={{ xs: 12, sm: 6, lg: 3 }}>
          <StatCard
            title="إجمالي الساعات"
            value={s.total.toLocaleString('ar')}
            icon={<AccessTimeRounded fontSize="inherit" />}
          />
        </Grid>
        <Grid size={{ xs: 12, sm: 6, lg: 3 }}>
          <StatCard
            title="ساعات هذا الشهر"
            value={s.month.toLocaleString('ar')}
            icon={<CalendarMonthRounded fontSize="inherit" />}
          />
        </Grid>
        <Grid size={{ xs: 12, sm: 6, lg: 3 }}>
          <StatCard
            title="الأكثر تشغيلًا"
            value={s.top ? `${s.top.g.name} (${s.top.h})` : '—'}
            icon={<EmojiEventsRounded fontSize="inherit" />}
            color="secondary.main"
          />
        </Grid>
      </Grid>

      <Grid container spacing={2} mt={1}>
        <Grid size={{ xs: 12, lg: 7 }}>
          <DailyChart data={dailyChart(data.logs)} />
        </Grid>
        <Grid size={{ xs: 12, lg: 5 }}>
          <MonthlyChart data={monthlyByGenerator(data.generators, data.logs)} />
        </Grid>
      </Grid>

      <Grid container spacing={2} mt={1}>
        <Grid size={{ xs: 12, md: 6 }}>
          <Card sx={{ height: '100%' }}>
            <CardContent>
              <Typography variant="h6" mb={2}>
                أحدث السجلات
              </Typography>
              <Stack spacing={1}>
                {sortLogs(data.logs)
                  .slice(0, 6)
                  .map(x => {
                    const g = data.generators.find(y => y.id === x.generatorId);
                    return (
                      <Box
                        key={x.id}
                        onClick={() => nav(`/logs?generator=${x.generatorId}`)}
                        sx={{
                          p: 1.5,
                          borderRadius: 2.5,
                          bgcolor: 'action.hover',
                          cursor: 'pointer',
                          display: 'flex',
                          justifyContent: 'space-between',
                          alignItems: 'center',
                          transition: 'background-color 0.2s ease',
                          '&:hover': { bgcolor: 'action.selected' },
                        }}
                      >
                        <span>{g?.name || 'مولد غير معروف'}</span>
                        <b className="tabular-nums">
                          {x.operatingHours} ساعة | {niceDate(x.date)}
                        </b>
                      </Box>
                    );
                  })}
                {!data.logs.length && (
                  <Typography color="text.secondary">لا توجد سجلات بعد.</Typography>
                )}
              </Stack>
            </CardContent>
          </Card>
        </Grid>

        <Grid size={{ xs: 12, md: 6 }}>
          <Card sx={{ height: '100%' }}>
            <CardContent>
              <Typography variant="h6" mb={2}>
                مولدات بلا سجلات
              </Typography>
              <Stack direction="row" flexWrap="wrap" gap={1}>
                {noLogs.map(g => (
                  <Chip
                    key={g.id}
                    label={`${g.number} | ${g.name}`}
                    onClick={() => nav(noLogsLink(g))}
                  />
                ))}
                {!noLogs.length && (
                  <Typography color="success.main">جميع المولدات لديها سجلات.</Typography>
                )}
              </Stack>
            </CardContent>
          </Card>
        </Grid>
      </Grid>
    </>
  );
}
