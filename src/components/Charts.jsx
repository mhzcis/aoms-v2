import { Card, CardContent, Typography } from '@mui/material';
import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';

const tooltipStyle = {
  borderRadius: 12,
  border: '1px solid rgba(148, 163, 184, 0.25)',
  boxShadow: '0 8px 24px rgba(15, 23, 42, 0.12)',
  textAlign: 'right',
  direction: 'rtl',
};

export const DailyChart = ({ data }) => (
  <Card>
    <CardContent>
      <Typography variant="h6" mb={2}>
        ساعات التشغيل اليومية، آخر 30 يومًا
      </Typography>
      <div style={{ height: 300 }}>
        <ResponsiveContainer>
          <AreaChart data={data}>
            <defs>
              <linearGradient id="c" x1="0" y1="0" x2="0" y2="1">
                <stop offset="5%" stopColor="#0f766e" stopOpacity={0.7} />
                <stop offset="95%" stopColor="#0f766e" stopOpacity={0} />
              </linearGradient>
            </defs>
            <CartesianGrid strokeDasharray="3 3" strokeOpacity={0.35} />
            <XAxis dataKey="date" />
            <YAxis orientation="right" />
            <Tooltip contentStyle={tooltipStyle} />
            <Area
              type="monotone"
              dataKey="hours"
              name="الساعات"
              stroke="#0f766e"
              strokeWidth={2.5}
              fill="url(#c)"
            />
          </AreaChart>
        </ResponsiveContainer>
      </div>
    </CardContent>
  </Card>
);

export const MonthlyChart = ({ data }) => (
  <Card>
    <CardContent>
      <Typography variant="h6" mb={2}>
        ساعات الشهر حسب المولد
      </Typography>
      <div style={{ height: 300 }}>
        <ResponsiveContainer>
          <BarChart data={data}>
            <CartesianGrid strokeDasharray="3 3" strokeOpacity={0.35} />
            <XAxis dataKey="name" />
            <YAxis orientation="right" />
            <Tooltip contentStyle={tooltipStyle} />
            <Bar dataKey="hours" name="الساعات" fill="#f59e0b" radius={[8, 8, 0, 0]}>
              {data.map(x => (
                <Cell key={x.id} fill={x.color} />
              ))}
            </Bar>
          </BarChart>
        </ResponsiveContainer>
      </div>
    </CardContent>
  </Card>
);
