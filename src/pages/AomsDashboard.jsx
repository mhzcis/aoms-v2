import Select from '../components/AccessibleSelect';
import { businessTimeZone, businessDateTime, recentEvents } from '../utils/businessTime';
import { useMemo, useState } from 'react';
import {
  Alert,
  Box,
  Card,
  CardContent,
  Chip,
  FormControl,
  Grid,
  InputLabel,
  MenuItem,
  Stack,
  TextField,
  Typography,
} from '@mui/material';
import { alpha } from '@mui/material/styles';
import {
  CategoryRounded,
  CheckCircleRounded,
  HistoryRounded,
  LocalGasStationRounded,
  NotificationsActiveRounded,
  PrecisionManufacturingRounded,
  ScienceRounded,
  SpeedRounded,
  TimelineRounded,
  TuneRounded,
  WaterDropRounded,
} from '@mui/icons-material';
import { useNavigate } from 'react-router-dom';
import { useAoms } from '../context/AomsContext';
import { PageTitle, StatCard } from '../components/Common';
import { DailyWaterChart, FuelByAssetChart, HoursByAssetChart } from '../components/AomsCharts';
import {
  calculateChlorineBalance,
  calculateTankBalance,
  roundNum,
  STATUS,
} from '../domain/models';

export default function AomsDashboard() {
  const { data } = useAoms();
  const nav = useNavigate();
  const [catFilter, setCatFilter] = useState('all');
  const [assetFilter, setAssetFilter] = useState('all');
  const [fromDate, setFromDate] = useState('');
  const [toDate, setToDate] = useState('');

  const categories = data.categories || [];
  const assets = data.assets || [];
  const operationLogs = data.operation_logs || [];
  const fuelTypes = data.fuel_types || [];
  const fuelTransactions = data.fuel_transactions || [];
  const chlorineTransactions = data.chlorine_transactions || [];
  const timelineEvents = data.timeline_events || [];
  const timeZone = businessTimeZone(data);

  const filteredAssets = useMemo(
    () =>
      assets.filter(
        a =>
          (catFilter === 'all' || a.category_id === catFilter) &&
          (assetFilter === 'all' || a.id === assetFilter)
      ),
    [assets, catFilter, assetFilter]
  );

  const filteredAssetIds = useMemo(() => new Set(filteredAssets.map(a => a.id)), [filteredAssets]);
  const catMap = useMemo(() => new Map(categories.map(c => [c.id, c])), [categories]);

  const filteredLogs = useMemo(
    () =>
      operationLogs.filter(
        l =>
          filteredAssetIds.has(l.asset_id) &&
          (!fromDate || l.operation_date >= fromDate) &&
          (!toDate || l.operation_date <= toDate)
      ),
    [operationLogs, filteredAssetIds, fromDate, toDate]
  );

  // عدم جمع فروق عدادات بوحدات مختلفة في مؤشر واحد (القسم 15 من المواصفات)
  const usageByUnit = useMemo(() => {
    const map = {};
    for (const l of filteredLogs) {
      const a = assets.find(x => x.id === l.asset_id);
      const c = catMap.get(a?.category_id);
      if (c?.uses_meter && c.meter_unit && l.usage_value != null) {
        map[c.meter_unit] = roundNum((map[c.meter_unit] || 0) + Number(l.usage_value || 0));
      }
    }
    return map;
  }, [filteredLogs, assets, catMap]);

  const assetsWithoutLogs = useMemo(() => {
    const loggedIds = new Set(operationLogs.map(l => l.asset_id));
    return filteredAssets.filter(a => !loggedIds.has(a.id));
  }, [filteredAssets, operationLogs]);

  // Water: total pumped vs distributed by tankers vs network (pump logs only).
  const waterStats = useMemo(() => {
    let total = 0;
    let tankers = 0;
    let network = 0;
    let trips = 0;
    const byDay = new Map();
    for (const l of filteredLogs) {
      if (l.water_total == null) continue;
      const w = Number(l.water_total || 0);
      const d = Number(l.distributed_quantity || 0);
      const n = l.network_quantity != null ? Number(l.network_quantity) : roundNum(w - d);
      total += w;
      tankers += d;
      network += n;
      trips += Number(l.trips_count || 0);
      const day = byDay.get(l.operation_date) || { date: l.operation_date, network: 0, tankers: 0 };
      day.network = roundNum(day.network + n);
      day.tankers = roundNum(day.tankers + d);
      byDay.set(l.operation_date, day);
    }
    return {
      total: roundNum(total),
      tankers: roundNum(tankers),
      network: roundNum(network),
      trips,
      daily: [...byDay.values()].sort((a, b) => a.date.localeCompare(b.date)).slice(-31),
    };
  }, [filteredLogs]);

  const perAsset = useMemo(() => {
    const fuel = [];
    const hours = [];
    for (const a of filteredAssets) {
      const c = catMap.get(a.category_id);
      const logs = filteredLogs.filter(l => l.asset_id === a.id);
      if (c?.supports_fuel && a.fuel_type_id) {
        fuel.push({
          code: a.asset_code,
          label: `${a.asset_code} — ${a.name}`,
          fuel: roundNum(logs.reduce((s, l) => s + Number(l.fuel_consumed || 0), 0)),
        });
      }
      if (c?.uses_meter && String(c.meter_unit || '').includes('ساعة')) {
        hours.push({
          code: a.asset_code,
          label: `${a.asset_code} — ${a.name}`,
          hours: roundNum(logs.reduce((s, l) => s + Number(l.usage_value ?? l.net_operation_delta ?? 0), 0)),
        });
      }
    }
    return { fuel, hours };
  }, [filteredAssets, filteredLogs, catMap]);

  const lowBalanceAlerts = useMemo(() => {
    const alerts = [];
    for (const a of filteredAssets) {
      const c = catMap.get(a.category_id);
      // One tank per asset: the tank's fuel type comes from the asset card.
      if (c?.supports_fuel && a.fuel_type_id) {
        const ft = fuelTypes.find(x => x.id === a.fuel_type_id);
        const tb = calculateTankBalance(a, fuelTransactions, operationLogs);
        const hasMovement = tb.supplied || tb.adjustedPlus || tb.adjustedMinus || tb.consumed;
        if (hasMovement && tb.balance <= 20) {
          alerts.push({
            id: `fuel-${a.id}`,
            asset: a,
            label: `${a.asset_code} — رصيد خزان ${ft?.name || ''}: ${tb.balance} ${ft?.unit || 'لتر'}`,
            tab: 'fuel_transactions',
          });
        }
      }
      if (c?.supports_chlorine) {
        const hasChl = chlorineTransactions.some(t => t.asset_id === a.id);
        if (hasChl) {
          const bal = calculateChlorineBalance(a.id, chlorineTransactions, operationLogs);
          if (bal <= 5) {
            alerts.push({
              id: `chl-${a.id}`,
              asset: a,
              label: `${a.asset_code} — رصيد الكلور: ${bal} ${c.chlorine_unit || 'كجم'}`,
              tab: 'chlorine_transactions',
            });
          }
        }
      }
    }
    return alerts;
  }, [filteredAssets, catMap, fuelTypes, fuelTransactions, chlorineTransactions, operationLogs]);

  const activeCategoriesCount = categories.filter(c => c.status === STATUS.ACTIVE).length;
  const activeAssetsCount = filteredAssets.filter(a => a.status === STATUS.ACTIVE).length;

  return (
    <>
      <PageTitle
        title="لوحة التحكم"
        subtitle="مؤشرات الأداء والتشغيل والأرصدة النظرية للأصول والمعدات"
        badge={
          <Chip
            size="small"
            color="primary"
            icon={<SpeedRounded fontSize="small" />}
            label="مراقبة تشغيلية فورية"
          />
        }
      />

      <Card sx={{ mb: 3 }}>
        <CardContent sx={{ p: 2.5 }}>
          <Stack direction="row" spacing={1} alignItems="center" mb={2}>
            <TuneRounded color="primary" fontSize="small" />
            <Typography variant="subtitle1" fontWeight={800}>
              تصفية مؤشرات الأداء والنطاق الزمني
            </Typography>
          </Stack>
          <Grid container spacing={2}>
            <Grid size={{ xs: 12, sm: 6, md: 3 }}>
              <FormControl fullWidth size="small">
                <InputLabel>التصنيف</InputLabel>
                <Select
                  label="التصنيف"
                  value={catFilter}
                  onChange={e => {
                    setCatFilter(e.target.value);
                    setAssetFilter('all');
                  }}
                >
                  <MenuItem value="all">جميع التصنيفات</MenuItem>
                  {categories.map(c => (
                    <MenuItem key={c.id} value={c.id}>
                      {c.code_prefix} | {c.name}
                    </MenuItem>
                  ))}
                </Select>
              </FormControl>
            </Grid>
            <Grid size={{ xs: 12, sm: 6, md: 3 }}>
              <FormControl fullWidth size="small">
                <InputLabel>الأصل</InputLabel>
                <Select
                  label="الأصل"
                  value={assetFilter}
                  onChange={e => setAssetFilter(e.target.value)}
                >
                  <MenuItem value="all">جميع الأصول</MenuItem>
                  {assets
                    .filter(a => catFilter === 'all' || a.category_id === catFilter)
                    .map(a => (
                      <MenuItem key={a.id} value={a.id}>
                        {a.asset_code} | {a.name}
                      </MenuItem>
                    ))}
                </Select>
              </FormControl>
            </Grid>
            <Grid size={{ xs: 6, md: 3 }}>
              <TextField
                fullWidth
                size="small"
                type="date"
                label="من تاريخ"
                InputLabelProps={{ shrink: true }}
                value={fromDate}
                onChange={e => setFromDate(e.target.value)}
              />
            </Grid>
            <Grid size={{ xs: 6, md: 3 }}>
              <TextField
                fullWidth
                size="small"
                type="date"
                label="إلى تاريخ"
                InputLabelProps={{ shrink: true }}
                value={toDate}
                onChange={e => setToDate(e.target.value)}
              />
            </Grid>
          </Grid>
        </CardContent>
      </Card>

      <Grid container spacing={2}>
        <Grid size={{ xs: 12, sm: 6, lg: 3 }}>
          <StatCard
            title="التصنيفات النشطة"
            value={`${activeCategoriesCount} / ${categories.length}`}
            subtitle="تصنيفات الأصول المعتمدة"
            icon={<CategoryRounded fontSize="inherit" />}
            color="primary.main"
          />
        </Grid>
        <Grid size={{ xs: 12, sm: 6, lg: 3 }}>
          <StatCard
            title="الأصول النشطة / الإجمالي"
            value={`${activeAssetsCount} / ${filteredAssets.length}`}
            subtitle="المعدات الجاهزة للتشغيل"
            icon={<PrecisionManufacturingRounded fontSize="inherit" />}
            color="info.main"
          />
        </Grid>
        <Grid size={{ xs: 12, sm: 6, lg: 3 }}>
          <StatCard
            title="سجلات التشغيل (الفترة)"
            value={filteredLogs.length}
            subtitle="سجلات موثقة ضمن الفلتر"
            icon={<HistoryRounded fontSize="inherit" />}
            color="success.main"
          />
        </Grid>
        <Grid size={{ xs: 12, sm: 6, lg: 3 }}>
          <StatCard
            title="الأحداث الموثقة"
            value={timelineEvents.length}
            subtitle="في الخط الزمني الموحد"
            icon={<TimelineRounded fontSize="inherit" />}
            color="secondary.main"
          />
        </Grid>
      </Grid>

      <Card
        sx={{
          mt: 2.5,
          background: theme =>
            theme.palette.mode === 'dark'
              ? 'linear-gradient(135deg, rgba(20, 184, 166, 0.12) 0%, rgba(15, 26, 44, 0.95) 100%)'
              : 'linear-gradient(135deg, rgba(15, 118, 110, 0.06) 0%, #ffffff 100%)',
        }}
      >
        <CardContent sx={{ p: 2.5 }}>
          <Typography variant="h6" mb={1.5} fontWeight={800}>
            إجمالي التشغيل حسب وحدة العداد (مفصول حسب الوحدة منعًا للجمع المضلل)
          </Typography>
          <Stack direction="row" spacing={1.5} flexWrap="wrap" useFlexGap>
            {Object.entries(usageByUnit).map(([unit, val]) => (
              <Chip
                key={unit}
                color="primary"
                label={`${unit}: ${val.toLocaleString('ar')}`}
                sx={{ fontWeight: 800, fontSize: '0.92rem', py: 2.25, px: 1 }}
              />
            ))}
            {Object.keys(usageByUnit).length === 0 && (
              <Typography color="text.secondary">
                لا توجد قراءات عداد مسجلة ضمن النطاق المحدد.
              </Typography>
            )}
          </Stack>
        </CardContent>
      </Card>

      <Card sx={{ mt: 2.5 }} data-testid="kpi-water">
        <Box sx={{ height: 5, bgcolor: 'info.main' }} />
        <CardContent sx={{ p: 2.5 }}>
          <Stack direction="row" spacing={1} alignItems="center" mb={1.5}>
            <WaterDropRounded color="info" fontSize="small" />
            <Typography variant="h6" fontWeight={800}>
              المياه المنتجة: الصهاريج مقابل الشبكة
            </Typography>
          </Stack>
          <Grid container spacing={2}>
            {[
              { k: 'total', label: 'إجمالي المياه', v: waterStats.total, tone: 'info' },
              { k: 'tankers', label: `الصهاريج (${waterStats.trips} نقلة)`, v: waterStats.tankers, tone: 'secondary' },
              { k: 'network', label: 'الشبكة', v: waterStats.network, tone: 'primary' },
            ].map(x => (
              <Grid size={{ xs: 12, sm: 4 }} key={x.k}>
                <Box
                  data-testid={`kpi-water-${x.k}`}
                  sx={{
                    p: 1.75,
                    borderRadius: 3,
                    border: '1px solid',
                    borderColor: theme => alpha(theme.palette[x.tone].main, 0.3),
                    bgcolor: theme => alpha(theme.palette[x.tone].main, theme.palette.mode === 'dark' ? 0.14 : 0.06),
                  }}
                >
                  <Typography variant="body2" color="text.secondary" fontWeight={700}>
                    {x.label}
                  </Typography>
                  <Typography variant="h5" fontWeight={900} className="tabular-nums">
                    {x.v.toLocaleString('ar')} م³
                  </Typography>
                </Box>
              </Grid>
            ))}
          </Grid>
          {waterStats.total > 0 && (
            <Box
              sx={{ mt: 2, height: 10, borderRadius: 5, overflow: 'hidden', display: 'flex', bgcolor: 'action.hover' }}
              aria-label="نسبة الصهاريج إلى الشبكة"
            >
              <Box sx={{ width: `${(waterStats.network / waterStats.total) * 100}%`, bgcolor: 'primary.main' }} />
              <Box sx={{ width: `${(waterStats.tankers / waterStats.total) * 100}%`, bgcolor: 'secondary.main' }} />
            </Box>
          )}
        </CardContent>
      </Card>

      <Grid container spacing={2} mt={1}>
        <Grid size={{ xs: 12, lg: 6 }}>
          <DailyWaterChart data={waterStats.daily} />
        </Grid>
        <Grid size={{ xs: 12, md: 6, lg: 3 }}>
          <FuelByAssetChart data={perAsset.fuel} />
        </Grid>
        <Grid size={{ xs: 12, md: 6, lg: 3 }}>
          <HoursByAssetChart data={perAsset.hours} />
        </Grid>
      </Grid>

      <Grid container spacing={2} mt={1}>
        <Grid size={{ xs: 12, md: 4 }}>
          <Card sx={{ height: '100%' }}>
            <Box sx={{ height: 4, bgcolor: 'primary.main' }} />
            <CardContent sx={{ p: 2.5 }}>
              <Stack direction="row" spacing={1} alignItems="center" mb={2}>
                <TimelineRounded color="primary" fontSize="small" />
                <Typography variant="h6" fontWeight={800}>
                  أحدث الأحداث التشغيلية
                </Typography>
              </Stack>
              <Stack spacing={1.25}>
                {recentEvents(timelineEvents, { timeZone, from: fromDate, to: toDate, ...((catFilter !== 'all' || assetFilter !== 'all') ? { assetIds: filteredAssetIds } : {}) }).map(evt => (
                  <Box
                    key={evt.id}
                    onClick={() =>
                      evt.asset_id && nav(`/operation_logs?asset=${evt.asset_id}`)
                    }
                    sx={{
                      p: 1.5,
                      borderRadius: 3,
                      bgcolor: 'action.hover',
                      border: '1px solid',
                      borderColor: 'divider',
                      cursor: evt.asset_id ? 'pointer' : 'default',
                      display: 'flex',
                      justifyContent: 'space-between',
                      alignItems: 'center',
                      gap: 1.5,
                    }}
                  >
                    <span style={{ fontWeight: 600, fontSize: '0.9rem' }}>{evt.title}</span>
                    <Chip
                      size="small"
                      variant="outlined"
                      label={businessDateTime(evt.created_at, timeZone)}
                    />
                  </Box>
                ))}
                {!timelineEvents.length && (
                  <Typography color="text.secondary">لا توجد أحداث مسجلة بعد.</Typography>
                )}
              </Stack>
            </CardContent>
          </Card>
        </Grid>

        <Grid size={{ xs: 12, md: 4 }}>
          <Card sx={{ height: '100%' }}>
            <Box sx={{ height: 4, bgcolor: 'info.main' }} />
            <CardContent sx={{ p: 2.5 }}>
              <Stack direction="row" spacing={1} alignItems="center" mb={2}>
                <PrecisionManufacturingRounded color="info" fontSize="small" />
                <Typography variant="h6" fontWeight={800}>
                  أصول بلا سجلات تشغيل
                </Typography>
              </Stack>
              <Stack direction="row" flexWrap="wrap" gap={1}>
                {assetsWithoutLogs.map(a => (
                  <Chip
                    key={a.id}
                    color="info"
                    variant="outlined"
                    label={`${a.asset_code} | ${a.name}`}
                    onClick={() => nav(`/operation_logs?asset=${a.id}&new=1`)}
                    sx={{ fontWeight: 700 }}
                  />
                ))}
                {!assetsWithoutLogs.length && (
                  <Stack direction="row" spacing={1} alignItems="center" sx={{ color: 'success.main' }}>
                    <CheckCircleRounded fontSize="small" />
                    <Typography color="success.main" fontWeight={700}>
                      جميع الأصول ضمن النطاق لديها سجلات.
                    </Typography>
                  </Stack>
                )}
              </Stack>
            </CardContent>
          </Card>
        </Grid>

        <Grid size={{ xs: 12, md: 4 }}>
          <Card sx={{ height: '100%' }}>
            <Box sx={{ height: 4, bgcolor: 'warning.main' }} />
            <CardContent sx={{ p: 2.5 }}>
              <Stack direction="row" spacing={1} alignItems="center" mb={2}>
                <NotificationsActiveRounded color="warning" fontSize="small" />
                <Typography variant="h6" fontWeight={800}>
                  تنبيهات أرصدة الوقود والكلور المنخفضة
                </Typography>
              </Stack>
              <Stack spacing={1.25}>
                {lowBalanceAlerts.map(item => (
                  <Alert
                    key={item.id}
                    severity="warning"
                    icon={
                      item.tab === 'fuel_transactions' ? (
                        <LocalGasStationRounded />
                      ) : (
                        <ScienceRounded />
                      )
                    }
                    sx={{ cursor: 'pointer' }}
                    onClick={() => nav(`/${item.tab}?asset=${item.asset.id}`)}
                  >
                    {item.label}
                  </Alert>
                ))}
                {!lowBalanceAlerts.length && (
                  <Stack direction="row" spacing={1} alignItems="center" sx={{ color: 'success.main' }}>
                    <CheckCircleRounded fontSize="small" />
                    <Typography color="success.main" fontWeight={700}>
                      لا توجد أرصدة وقود أو كلور منخفضة حاليًا.
                    </Typography>
                  </Stack>
                )}
              </Stack>
            </CardContent>
          </Card>
        </Grid>
      </Grid>
    </>
  );
}
