import { Box, Card, CardContent, Stack, Typography } from '@mui/material';
import { alpha, useTheme } from '@mui/material/styles';
import {
  Bar,
  BarChart,
  CartesianGrid,
  Legend,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';

/** Theme-aware chart card (Gemini style): rounded card, soft tinted header strip, RTL axes. */
function ChartCard({ title, subtitle, testId, empty, children }) {
  return (
    <Card sx={{ height: '100%' }} data-testid={testId}>
      <Box sx={{ height: 4, bgcolor: 'primary.main' }} />
      <CardContent sx={{ p: { xs: 1.5, sm: 2.5 } }}>
        <Stack spacing={0.25} mb={1.5}>
          <Typography variant="h6" fontWeight={800} sx={{ fontSize: { xs: '1rem', sm: '1.1rem' } }}>
            {title}
          </Typography>
          {subtitle && (
            <Typography variant="caption" color="text.secondary">
              {subtitle}
            </Typography>
          )}
        </Stack>
        {empty ? (
          <Typography color="text.secondary" sx={{ py: 6, textAlign: 'center' }}>
            لا توجد بيانات ضمن النطاق المحدد.
          </Typography>
        ) : (
          // SVG charts render left-to-right; axes are mirrored (reversed X, Y on the right) for RTL reading.
          <Box dir="ltr" sx={{ width: '100%', height: { xs: 240, sm: 280 }, minWidth: 0 }}>
            {children}
          </Box>
        )}
      </CardContent>
    </Card>
  );
}

function useChartTheme() {
  const theme = useTheme();
  const text = theme.palette.text.secondary;
  return {
    theme,
    axis: { fill: text, fontSize: 11, fontFamily: theme.typography.fontFamily },
    grid: alpha(theme.palette.divider, theme.palette.mode === 'dark' ? 0.5 : 0.9),
    tooltip: {
      contentStyle: {
        borderRadius: 12,
        border: `1px solid ${theme.palette.divider}`,
        background: theme.palette.background.paper,
        color: theme.palette.text.primary,
        boxShadow: '0 8px 24px rgba(15, 23, 42, 0.18)',
        textAlign: 'right',
        direction: 'rtl',
        fontFamily: theme.typography.fontFamily,
      },
      labelStyle: { color: theme.palette.text.primary, fontWeight: 700 },
      itemStyle: { color: theme.palette.text.primary },
      cursor: { fill: alpha(theme.palette.primary.main, 0.08) },
    },
    legend: { wrapperStyle: { direction: 'rtl', fontFamily: theme.typography.fontFamily, fontSize: 12, color: text } },
  };
}

export function DailyWaterChart({ data }) {
  const c = useChartTheme();
  return (
    <ChartCard
      title="المياه اليومية: الشبكة مقابل الصهاريج"
      subtitle="م³ يوميًا — الشبكة = الإجمالي − الكمية الموزعة بالصهاريج"
      testId="chart-daily-water"
      empty={!data.length}
    >
      <ResponsiveContainer>
        <BarChart data={data} margin={{ top: 8, right: 8, left: 8, bottom: 4 }}>
          <CartesianGrid strokeDasharray="3 3" stroke={c.grid} vertical={false} />
          <XAxis dataKey="date" reversed tick={c.axis} tickLine={false} axisLine={{ stroke: c.grid }} />
          <YAxis orientation="right" tick={c.axis} tickLine={false} axisLine={false} width={44} />
          <Tooltip {...c.tooltip} />
          <Legend {...c.legend} />
          <Bar dataKey="network" name="الشبكة" stackId="w" fill={c.theme.palette.primary.main} radius={[0, 0, 0, 0]} />
          <Bar dataKey="tankers" name="الصهاريج" stackId="w" fill={c.theme.palette.secondary.main} radius={[8, 8, 0, 0]} />
        </BarChart>
      </ResponsiveContainer>
    </ChartCard>
  );
}

function AssetBarChart({ data, dataKey, name, color, title, subtitle, testId }) {
  const c = useChartTheme();
  return (
    <ChartCard title={title} subtitle={subtitle} testId={testId} empty={!data.length}>
      <ResponsiveContainer>
        <BarChart data={data} margin={{ top: 8, right: 8, left: 8, bottom: 4 }}>
          <CartesianGrid strokeDasharray="3 3" stroke={c.grid} vertical={false} />
          <XAxis dataKey="code" reversed tick={c.axis} tickLine={false} axisLine={{ stroke: c.grid }} />
          <YAxis orientation="right" tick={c.axis} tickLine={false} axisLine={false} width={44} />
          <Tooltip {...c.tooltip} labelFormatter={(label, p) => p?.[0]?.payload?.label || label} />
          <Bar dataKey={dataKey} name={name} fill={color(c.theme)} radius={[8, 8, 0, 0]} maxBarSize={56} />
        </BarChart>
      </ResponsiveContainer>
    </ChartCard>
  );
}

export const FuelByAssetChart = ({ data }) => (
  <AssetBarChart
    data={data}
    dataKey="fuel"
    name="الوقود المستهلك"
    color={t => t.palette.warning.main}
    title="استهلاك الوقود لكل أصل"
    subtitle="محسوب آليًا = ساعات التشغيل × استهلاك الوقود في الساعة"
    testId="chart-fuel-asset"
  />
);

export const HoursByAssetChart = ({ data }) => (
  <AssetBarChart
    data={data}
    dataKey="hours"
    name="ساعات التشغيل"
    color={t => t.palette.info.main}
    title="ساعات التشغيل لكل أصل"
    subtitle="مجموع فروق العداد بوحدة «ساعة تشغيل» ضمن الفلتر"
    testId="chart-hours-asset"
  />
);
