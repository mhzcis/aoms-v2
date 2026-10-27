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
  Select,
  Stack,
  TextField,
  Typography,
} from '@mui/material';
import {
  CategoryRounded,
  HistoryRounded,
  LocalGasStationRounded,
  PrecisionManufacturingRounded,
  ScienceRounded,
  TimelineRounded,
} from '@mui/icons-material';
import { useNavigate } from 'react-router-dom';
import { useAoms } from '../context/AomsContext';
import { StatCard } from '../components/Common';
import {
  calculateChlorineBalance,
  calculateFuelBalance,
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

  const lowBalanceAlerts = useMemo(() => {
    const alerts = [];
    for (const a of filteredAssets) {
      const c = catMap.get(a.category_id);
      if (c?.supports_fuel) {
        for (const ft of fuelTypes.filter(x => x.status === STATUS.ACTIVE)) {
          const hasTx = fuelTransactions.some(t => t.asset_id === a.id && t.fuel_type_id === ft.id);
          if (hasTx) {
            const bal = calculateFuelBalance(a.id, ft.id, fuelTransactions, operationLogs, fuelTypes);
            if (bal <= 20) {
              alerts.push({
                id: `fuel-${a.id}-${ft.id}`,
                asset: a,
                label: `${a.asset_code} — رصيد ${ft.name}: ${bal} ${ft.unit}`,
                tab: 'fuel_transactions',
              });
            }
          }
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
      <Typography variant="h4" mb={1} fontWeight={800}>
        لوحة التحكم
      </Typography>
      <Typography color="text.secondary" mb={3}>
        مؤشرات الأداء والتشغيل والأرصدة النظرية للأصول والمعدات
      </Typography>

      <Card sx={{ mb: 3 }}>
        <CardContent>
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
            icon={<CategoryRounded fontSize="inherit" />}
          />
        </Grid>
        <Grid size={{ xs: 12, sm: 6, lg: 3 }}>
          <StatCard
            title="الأصول النشطة / الإجمالي"
            value={`${activeAssetsCount} / ${filteredAssets.length}`}
            icon={<PrecisionManufacturingRounded fontSize="inherit" />}
          />
        </Grid>
        <Grid size={{ xs: 12, sm: 6, lg: 3 }}>
          <StatCard
            title="سجلات التشغيل (الفترة)"
            value={filteredLogs.length}
            icon={<HistoryRounded fontSize="inherit" />}
          />
        </Grid>
        <Grid size={{ xs: 12, sm: 6, lg: 3 }}>
          <StatCard
            title="الأحداث الموثقة"
            value={timelineEvents.length}
            icon={<TimelineRounded fontSize="inherit" />}
            color="secondary.main"
          />
        </Grid>
      </Grid>

      <Card sx={{ mt: 2 }}>
        <CardContent>
          <Typography variant="h6" mb={1.5}>
            إجمالي التشغيل حسب وحدة العداد (مفصول حسب الوحدة منعًا للجمع المضلل)
          </Typography>
          <Stack direction="row" spacing={1.5} flexWrap="wrap" useFlexGap>
            {Object.entries(usageByUnit).map(([unit, val]) => (
              <Chip
                key={unit}
                color="primary"
                label={`${unit}: ${val.toLocaleString('ar')}`}
                sx={{ fontWeight: 700, fontSize: '0.9rem', py: 2 }}
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

      <Grid container spacing={2} mt={1}>
        <Grid size={{ xs: 12, md: 4 }}>
          <Card sx={{ height: '100%' }}>
            <CardContent>
              <Typography variant="h6" mb={2}>
                أحدث الأحداث التشغيلية
              </Typography>
              <Stack spacing={1}>
                {timelineEvents.slice(0, 6).map(evt => (
                  <Box
                    key={evt.id}
                    onClick={() =>
                      evt.asset_id && nav(`/operation_logs?asset=${evt.asset_id}`)
                    }
                    sx={{
                      p: 1.25,
                      borderRadius: 2,
                      bgcolor: 'action.hover',
                      cursor: evt.asset_id ? 'pointer' : 'default',
                      display: 'flex',
                      justifyContent: 'space-between',
                    }}
                  >
                    <span>{evt.title}</span>
                    <Typography variant="caption" color="text.secondary">
                      {String(evt.created_at || '').slice(0, 10)}
                    </Typography>
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
            <CardContent>
              <Typography variant="h6" mb={2}>
                أصول بلا سجلات تشغيل
              </Typography>
              <Stack direction="row" flexWrap="wrap" gap={1}>
                {assetsWithoutLogs.map(a => (
                  <Chip
                    key={a.id}
                    label={`${a.asset_code} | ${a.name}`}
                    onClick={() => nav(`/operation_logs?asset=${a.id}&new=1`)}
                  />
                ))}
                {!assetsWithoutLogs.length && (
                  <Typography color="success.main">جميع الأصول ضمن النطاق لديها سجلات.</Typography>
                )}
              </Stack>
            </CardContent>
          </Card>
        </Grid>

        <Grid size={{ xs: 12, md: 4 }}>
          <Card sx={{ height: '100%' }}>
            <CardContent>
              <Typography variant="h6" mb={2}>
                تنبيهات أرصدة الوقود والكلور المنخفضة
              </Typography>
              <Stack spacing={1}>
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
                  <Typography color="success.main">
                    لا توجد أرصدة وقود أو كلور منخفضة حاليًا.
                  </Typography>
                )}
              </Stack>
            </CardContent>
          </Card>
        </Grid>
      </Grid>
    </>
  );
}
