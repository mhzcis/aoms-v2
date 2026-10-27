import { useEffect, useMemo, useRef, useState } from 'react';
import {
  Alert,
  Box,
  Button,
  Card,
  CardContent,
  Checkbox,
  Chip,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  FormControl,
  FormControlLabel,
  Grid,
  IconButton,
  InputLabel,
  MenuItem,
  Paper,
  Select,
  Stack,
  Switch,
  Tab,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  Tabs,
  TextField,
  Tooltip,
  Typography,
} from '@mui/material';
import {
  AddRounded,
  BackupRounded,
  DeleteRounded,
  EditRounded,
  FileDownloadRounded,
  PictureAsPdfRounded,
  PrintRounded,
  RestoreRounded,
  SearchRounded,
  StarBorderRounded,
  StarRounded,
} from '@mui/icons-material';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { useAoms } from '../context/AomsContext';
import { PagedFooter, paginate } from '../components/Paged';
import {
  calculateChlorineBalance,
  calculateFuelBalance,
  canAdmin,
  canWrite,
  CHLORINE_TX_TYPES,
  effectiveValue,
  FIELD_SCOPES,
  FIELD_TYPES,
  FUEL_TX_TYPES,
  getOperationDateRule,
  localTodayISO,
  METER_UNITS,
  ROLES,
  roundNum,
  STATUS,
} from '../domain/models';
import {
  exportAomsCSV,
  exportAomsExcel,
  exportAomsPDF,
  formatUsageSummaryText,
  getAomsReportColumns,
} from '../services/aomsReportService';
import { stamp } from '../utils/dates';

const downloadJsonFile = (obj, filename) => {
  try {
    if (typeof URL?.createObjectURL !== 'function') return false;
    const blob = new Blob([JSON.stringify(obj, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    return true;
  } catch {
    return false;
  }
};

export function DynamicFieldInput({ field, options = [], value, onChange, disabled = false }) {
  const unitSuffix = field.unit ? ` (${field.unit})` : '';
  const label = `${field.label}${unitSuffix}${field.is_required ? ' *' : ''}`;

  if (field.field_type === 'boolean') {
    return (
      <FormControlLabel
        control={
          <Switch
            checked={value === true || value === 'true'}
            onChange={e => onChange(e.target.checked)}
            disabled={disabled}
          />
        }
        label={label}
      />
    );
  }

  if (field.field_type === 'select') {
    const activeOpts = options
      .filter(o => o.field_id === field.id && (o.is_active !== false || o.id === value))
      .sort((a, b) => a.sort_order - b.sort_order);
    return (
      <FormControl fullWidth size="small" disabled={disabled}>
        <InputLabel>{label}</InputLabel>
        <Select label={label} value={value || ''} onChange={e => onChange(e.target.value)}>
          <MenuItem value="">— اختر —</MenuItem>
          {activeOpts.map(o => (
            <MenuItem key={o.id} value={o.id}>
              {o.label}
            </MenuItem>
          ))}
        </Select>
      </FormControl>
    );
  }

  return (
    <TextField
      fullWidth
      size="small"
      type={field.field_type === 'number' ? 'number' : field.field_type === 'date' ? 'date' : 'text'}
      InputLabelProps={field.field_type === 'date' ? { shrink: true } : undefined}
      label={label}
      value={value ?? ''}
      onChange={e => onChange(e.target.value)}
      disabled={disabled}
    />
  );
}

// REPORT-011: human-readable scope labels for the report UI and export titles
// (previously the raw key, e.g. "all_assets", leaked into the PDF/Excel title).
const REPORT_SCOPE_LABELS = {
  all_assets: 'جميع الأصول',
  category: 'تصنيف كامل',
  asset: 'أصل واحد',
  multi_assets: 'مجموعة أصول مختارة',
};

const TIMELINE_ENTITY_TAB = {
  asset: 'assets',
  operation_log: 'operation_logs',
  fuel_transaction: 'fuel_transactions',
  chlorine_transaction: 'chlorine_transactions',
};

export default function EntityPage({ type }) {
  const { data, profile, online, service, runAction, refresh, setNotice } = useAoms();
  const [params, setParams] = useSearchParams();
  const nav = useNavigate();

  const isAdmin = canAdmin(profile);
  const canOperate = canWrite(profile);
  const canMutateAdmin = isAdmin && online;
  const canMutateOperate = canOperate && online;

  const categories = data.categories || [];
  const categoryFields = data.category_fields || [];
  const fieldOptions = data.category_field_options || [];
  const assets = useMemo(
    () => [...(data.assets || [])].sort((a, b) => String(a.asset_code || '').localeCompare(String(b.asset_code || ''))),
    [data.assets]
  );
  const assetFieldValues = data.asset_field_values || [];
  const operators = data.operators || [];
  const operationLogs = data.operation_logs || [];
  const operationLogValues = data.operation_log_values || [];
  const fuelTypes = data.fuel_types || [];
  const fuelTransactions = data.fuel_transactions || [];
  const chlorineTransactions = data.chlorine_transactions || [];
  const byNewest = (a, b) => String(b.created_at || '').localeCompare(String(a.created_at || ''));
  const timelineEvents = [...(data.timeline_events || [])].sort(byNewest);
  const auditLogs = [...(data.audit_logs || [])].sort(byNewest);
  const profiles = data.profiles || [];
  const appSettings = data.app_settings || [];

  const [q, setQ] = useState('');
  const [conflictRecord, setConflictRecord] = useState(null);

  // Version conflict wrapper
  const executeWithConflictGuard = async (fn, msg) => {
    try {
      setConflictRecord(null);
      return await runAction(fn, msg);
    } catch (err) {
      if (err?.currentRecord) {
        setConflictRecord(err.currentRecord);
      }
      throw err;
    }
  };

  // ==================== 1. CATEGORIES & DYNAMIC FIELDS ====================
  const [catDialog, setCatDialog] = useState(false);
  const [catForm, setCatForm] = useState({
    id: '',
    name: '',
    code_prefix: '',
    description: '',
    status: 'active',
    uses_meter: true,
    meter_unit: 'ساعة تشغيل',
    supports_fuel: true,
    supports_chlorine: false,
    default_fuel_rate: '',
    fuel_unit: 'لتر',
    default_chlorine_consumption: '',
    chlorine_unit: 'كجم',
    default_residual_chlorine: '',
  });
  const [fieldDialog, setFieldDialog] = useState(false);
  const [fieldForm, setFieldForm] = useState({
    id: '',
    category_id: '',
    scope: 'asset',
    field_key: '',
    label: '',
    description: '',
    field_type: 'text',
    unit: '',
    is_required: false,
    show_in_reports: true,
    sort_order: 0,
    is_active: true,
  });
  const [fieldOptsText, setFieldOptsText] = useState('');

  // ==================== 2. ASSETS ====================
  const [assetDialog, setAssetDialog] = useState(false);
  const [assetForm, setAssetForm] = useState({
    id: '',
    version: 1,
    name: '',
    category_id: '',
    location: '',
    status: 'active',
    notes: '',
    is_default: false,
    has_fuel_rate_override: false,
    fuel_rate_override: '',
    has_chlorine_consumption_override: false,
    chlorine_consumption_override: '',
    has_residual_chlorine_override: false,
    residual_chlorine_override: '',
  });
  const [assetDynValues, setAssetDynValues] = useState({});

  // ==================== 3. OPERATORS ====================
  const [opDialog, setOpDialog] = useState(false);
  const [opForm, setOpForm] = useState({ id: '', name: '', phone: '', notes: '', status: 'active' });

  // ==================== 4. OPERATION LOGS (Section 9.1) ====================
  const paramAssetId = params.get('asset') || '';
  const highlightId = params.get('highlight') || '';
  // REG-006: per-list paging state; see components/Paged.jsx
  const [paging, setPaging] = useState({});
  const pageRows = (key, rows, sig = q) => {
    const p = paginate(rows, paging[key], { highlightId, sig });
    p.onChange = patch =>
      setPaging(prev => ({ ...prev, [key]: { page: p.page, size: p.size, ...patch, sig: `${sig}|${highlightId}` } }));
    return p;
  };

  const [selectedCatId, setSelectedCatId] = useState('');
  const [selectedAssetId, setSelectedAssetId] = useState('');
  const [opLogForm, setOpLogForm] = useState({
    id: '',
    version: 1,
    operation_date: '',
    record_type: 'daily',
    operator_id: '',
    previous_reading: '',
    current_reading: '',
    chlorine_consumed: '',
    residual_chlorine: '',
    notes: '',
  });
  const [opDynValues, setOpDynValues] = useState({});

  useEffect(() => {
    if (type !== 'operation_logs') return;
    if (paramAssetId) {
      const targetAsset = assets.find(a => a.id === paramAssetId);
      if (targetAsset) {
        setSelectedCatId(targetAsset.category_id);
        setSelectedAssetId(targetAsset.id);
        return;
      }
    }
    if (!selectedCatId && categories.length > 0) {
      const firstCat = categories.find(c => c.status === 'active') || categories[0];
      if (firstCat) {
        setSelectedCatId(firstCat.id);
        const catAssets = assets.filter(a => a.category_id === firstCat.id);
        const defAsset = catAssets.find(a => a.is_default && a.status === 'active') || catAssets[0];
        setSelectedAssetId(defAsset?.id || '');
      }
    }
  }, [type, paramAssetId, categories, assets, selectedCatId]);

  const handleSelectCategoryForLogs = catId => {
    setSelectedCatId(catId);
    const catAssets = assets.filter(a => a.category_id === catId);
    const defAsset = catAssets.find(a => a.is_default && a.status === 'active') || catAssets[0];
    setSelectedAssetId(defAsset?.id || '');
  };

  // ==================== 5. FUEL & CHLORINE ====================
  const [fuelForm, setFuelForm] = useState({
    id: '',
    version: 1,
    asset_id: '',
    fuel_type_id: '',
    transaction_date: localTodayISO(),
    transaction_type: 'supply',
    quantity: '',
    operator_id: '',
    supplier: '',
    invoice_number: '',
    adjustment_reason: '',
    notes: '',
  });

  const [chlForm, setChlForm] = useState({
    id: '',
    version: 1,
    asset_id: '',
    transaction_date: localTodayISO(),
    transaction_type: 'receipt',
    quantity: '',
    supplier: '',
    adjustment_reason: '',
    notes: '',
  });

  // ==================== 6. REPORTS ====================
  const [repFilters, setRepFilters] = useState({
    scope: 'all_assets',
    assetId: '',
    categoryId: '',
    assetIds: [],
    from: '',
    to: '',
    operatorId: 'all',
    eventType: 'operation',
    fuelTypeId: 'all',
  });

  // ==================== 7. GLOBAL SEARCH ====================
  const [globalQ, setGlobalQ] = useState('');

  // ==================== 8. TIMELINE & AUDIT ====================
  const [timeTab, setTimeTab] = useState(0);

  // ==================== 9. SETTINGS & USERS & BACKUP ====================
  const [ftForm, setFtForm] = useState({ id: '', name: '', unit: 'لتر', status: 'active' });
  const [userForm, setUserForm] = useState({
    id: '',
    email: '',
    full_name: '',
    role: 'operator',
    status: 'active',
  });
  const [backupPreview, setBackupPreview] = useState(null);
  const [backupDoc, setBackupDoc] = useState(null);
  const backupFileRef = useRef(null);

  // Render helper for Version Conflict Banner
  const conflictBanner = conflictRecord && (
    <Alert
      severity="error"
      sx={{ mb: 2 }}
      action={
        <Button
          color="inherit"
          size="small"
          onClick={() => {
            setConflictRecord(null);
            refresh();
          }}
        >
          إعادة تحميل النسخة الحالية
        </Button>
      }
    >
      تعارض إصدار: تم تعديل هذا السجل من جهاز آخر. النسخة الحالية في قاعدة البيانات تحمل الإصدار رقم (
      {conflictRecord.version}). يرجى إعادة التحميل والمحاولة مجددًا.
    </Alert>
  );

  // -------------------- VIEW: CATEGORIES & DYNAMIC FIELDS --------------------
  if (type === 'categories') {
    const filteredCats = categories.filter(c =>
      [c.name, c.code_prefix, c.description].join(' ').toLowerCase().includes(q.toLowerCase())
    );
    const hasAssetsInCat = catId => assets.some(a => a.category_id === catId);

    return (
      <>
        {conflictBanner}
        <Stack direction="row" justifyContent="space-between" alignItems="center" mb={3} flexWrap="wrap" gap={2}>
          <Box>
            <Typography variant="h4" fontWeight={800}>
              التصنيفات ومحرك الحقول الديناميكية
            </Typography>
            <Typography color="text.secondary">
              إدارة تصنيفات الأصول، وحدات العداد، معدلات الوقود والكلور، والحقول الديناميكية
            </Typography>
          </Box>
          {isAdmin && (
            <Stack direction="row" spacing={1}>
              <Button
                variant="outlined"
                startIcon={<AddRounded />}
                disabled={!canMutateAdmin || !categories.length}
                onClick={() => {
                  setFieldForm({
                    id: '',
                    category_id: categories[0]?.id || '',
                    scope: 'asset',
                    field_key: '',
                    label: '',
                    description: '',
                    field_type: 'text',
                    unit: '',
                    is_required: false,
                    show_in_reports: true,
                    sort_order: 0,
                    is_active: true,
                  });
                  setFieldOptsText('');
                  setFieldDialog(true);
                }}
              >
                إضافة حقل ديناميكي
              </Button>
              <Button
                variant="contained"
                startIcon={<AddRounded />}
                disabled={!canMutateAdmin}
                onClick={() => {
                  setCatForm({
                    id: '',
                    name: '',
                    code_prefix: '',
                    description: '',
                    status: 'active',
                    uses_meter: true,
                    meter_unit: 'ساعة تشغيل',
                    supports_fuel: true,
                    supports_chlorine: false,
                    default_fuel_rate: '',
                    fuel_unit: 'لتر',
                    default_chlorine_consumption: '',
                    chlorine_unit: 'كجم',
                    default_residual_chlorine: '',
                  });
                  setCatDialog(true);
                }}
              >
                إضافة تصنيف
              </Button>
            </Stack>
          )}
        </Stack>

        <TextField
          fullWidth
          size="small"
          label="بحث في التصنيفات"
          value={q}
          onChange={e => setQ(e.target.value)}
          sx={{ mb: 2 }}
        />

        <Grid container spacing={2}>
          {filteredCats.map(cat => {
            const catFields = categoryFields
              .filter(f => f.category_id === cat.id)
              .sort((a, b) => a.sort_order - b.sort_order);
            return (
              <Grid size={{ xs: 12, md: 6 }} key={cat.id}>
                <Card>
                  <CardContent>
                    <Stack direction="row" justifyContent="space-between" alignItems="center">
                      <Box>
                        <Typography variant="h6" fontWeight={800}>
                          {cat.code_prefix} — {cat.name}
                        </Typography>
                        <Typography variant="body2" color="text.secondary">
                          {cat.description || 'بلا وصف'}
                        </Typography>
                      </Box>
                      <Stack direction="row" spacing={1} alignItems="center">
                        <Chip
                          size="small"
                          color={cat.status === 'active' ? 'success' : 'default'}
                          label={cat.status === 'active' ? 'نشط' : 'غير نشط'}
                        />
                        {isAdmin && (
                          <IconButton
                            size="small"
                            disabled={!canMutateAdmin}
                            onClick={() => {
                              setCatForm({
                                ...cat,
                                default_fuel_rate: cat.default_fuel_rate ?? '',
                                default_chlorine_consumption: cat.default_chlorine_consumption ?? '',
                                default_residual_chlorine: cat.default_residual_chlorine ?? '',
                              });
                              setCatDialog(true);
                            }}
                          >
                            <EditRounded fontSize="small" />
                          </IconButton>
                        )}
                      </Stack>
                    </Stack>

                    <Stack direction="row" spacing={1} mt={1.5} flexWrap="wrap" useFlexGap>
                      <Chip
                        size="small"
                        variant="outlined"
                        label={cat.uses_meter ? `عداد: ${cat.meter_unit}` : 'بلا عداد'}
                      />
                      {cat.supports_fuel && (
                        <Chip
                          size="small"
                          color="primary"
                          variant="outlined"
                          label={`وقود افتراضي: ${cat.default_fuel_rate ?? 0} ${cat.fuel_unit || 'لتر'}`}
                        />
                      )}
                      {cat.supports_chlorine && (
                        <Chip
                          size="small"
                          color="secondary"
                          variant="outlined"
                          label={`كلور افتراضي: ${cat.default_chlorine_consumption ?? 0} ${cat.chlorine_unit || 'كجم'}`}
                        />
                      )}
                    </Stack>

                    <Typography variant="subtitle2" mt={2} mb={1} fontWeight={700}>
                      الحقول الديناميكية ({catFields.length}):
                    </Typography>
                    <Stack spacing={0.75}>
                      {catFields.map(f => (
                        <Box
                          key={f.id}
                          sx={{
                            p: 1,
                            borderRadius: 2,
                            bgcolor: 'action.hover',
                            display: 'flex',
                            justifyContent: 'space-between',
                            alignItems: 'center',
                          }}
                        >
                          <span>
                            <b>{f.label}</b> ({f.scope === 'asset' ? 'حقل أصل' : 'حقل تشغيل'} • {f.field_type})
                            {f.is_required ? ' [إلزامي]' : ''}
                            {!f.is_active ? ' [معطل]' : ''}
                          </span>
                          {isAdmin && (
                            <IconButton
                              size="small"
                              disabled={!canMutateAdmin}
                              onClick={() => {
                                const opts = fieldOptions
                                  .filter(o => o.field_id === f.id)
                                  .map(o => o.label)
                                  .join('\n');
                                setFieldForm({ ...f });
                                setFieldOptsText(opts);
                                setFieldDialog(true);
                              }}
                            >
                              <EditRounded fontSize="small" />
                            </IconButton>
                          )}
                        </Box>
                      ))}
                      {!catFields.length && (
                        <Typography variant="caption" color="text.secondary">
                          لا توجد حقول ديناميكية مضافة لهذا التصنيف.
                        </Typography>
                      )}
                    </Stack>
                  </CardContent>
                </Card>
              </Grid>
            );
          })}
        </Grid>

        {/* Category Dialog */}
        <Dialog open={catDialog} onClose={() => setCatDialog(false)} fullWidth maxWidth="sm">
          <DialogTitle>{catForm.id ? 'تعديل تصنيف' : 'إضافة تصنيف جديد'}</DialogTitle>
          <DialogContent>
            <Stack spacing={2} mt={1}>
              <TextField
                label="اسم التصنيف *"
                value={catForm.name}
                onChange={e => setCatForm({ ...catForm, name: e.target.value })}
              />
              <TextField
                label="اختصار الكود (مثل GEN أو PMP أو TRK) *"
                value={catForm.code_prefix}
                disabled={Boolean(catForm.id && hasAssetsInCat(catForm.id))}
                helperText={
                  catForm.id && hasAssetsInCat(catForm.id)
                    ? 'مقفل لوجود أصول مسجلة تحت هذا التصنيف'
                    : 'أحرف لاتينية كبيرة دون مسافات'
                }
                onChange={e => setCatForm({ ...catForm, code_prefix: e.target.value })}
              />
              <TextField
                label="الوصف"
                value={catForm.description || ''}
                onChange={e => setCatForm({ ...catForm, description: e.target.value })}
              />
              <FormControl fullWidth>
                <InputLabel>الحالة</InputLabel>
                <Select
                  label="الحالة"
                  value={catForm.status}
                  onChange={e => setCatForm({ ...catForm, status: e.target.value })}
                >
                  <MenuItem value="active">نشط</MenuItem>
                  <MenuItem value="inactive">غير نشط (معطل)</MenuItem>
                </Select>
              </FormControl>
              <FormControlLabel
                control={
                  <Switch
                    checked={Boolean(catForm.uses_meter)}
                    onChange={e =>
                      setCatForm({
                        ...catForm,
                        uses_meter: e.target.checked,
                        meter_unit: e.target.checked ? catForm.meter_unit || 'ساعة تشغيل' : null,
                      })
                    }
                  />
                }
                label="يستخدم عداد قراءة؟"
              />
              {catForm.uses_meter && (
                <FormControl fullWidth>
                  <InputLabel>وحدة العداد *</InputLabel>
                  <Select
                    label="وحدة العداد *"
                    value={catForm.meter_unit || ''}
                    onChange={e => setCatForm({ ...catForm, meter_unit: e.target.value })}
                  >
                    {METER_UNITS.map(u => (
                      <MenuItem key={u} value={u}>
                        {u}
                      </MenuItem>
                    ))}
                  </Select>
                </FormControl>
              )}
              <FormControlLabel
                control={
                  <Switch
                    checked={Boolean(catForm.supports_fuel)}
                    onChange={e => setCatForm({ ...catForm, supports_fuel: e.target.checked })}
                  />
                }
                label="يدعم الوقود؟"
              />
              {catForm.supports_fuel && (
                <Stack direction="row" spacing={2}>
                  <TextField
                    fullWidth
                    type="number"
                    label="معدل استهلاك الوقود الافتراضي"
                    value={catForm.default_fuel_rate}
                    onChange={e => setCatForm({ ...catForm, default_fuel_rate: e.target.value })}
                  />
                  <TextField
                    fullWidth
                    label="وحدة الوقود"
                    value={catForm.fuel_unit || 'لتر'}
                    onChange={e => setCatForm({ ...catForm, fuel_unit: e.target.value })}
                  />
                </Stack>
              )}
              <FormControlLabel
                control={
                  <Switch
                    checked={Boolean(catForm.supports_chlorine)}
                    onChange={e => setCatForm({ ...catForm, supports_chlorine: e.target.checked })}
                  />
                }
                label="يدعم الكلور؟"
              />
              {catForm.supports_chlorine && (
                <Stack direction="row" spacing={2}>
                  <TextField
                    fullWidth
                    type="number"
                    label="استهلاك الكلور الافتراضي"
                    value={catForm.default_chlorine_consumption}
                    onChange={e =>
                      setCatForm({ ...catForm, default_chlorine_consumption: e.target.value })
                    }
                  />
                  <TextField
                    fullWidth
                    type="number"
                    label="نسبة الكلور العالقة الافتراضية"
                    value={catForm.default_residual_chlorine}
                    onChange={e =>
                      setCatForm({ ...catForm, default_residual_chlorine: e.target.value })
                    }
                  />
                </Stack>
              )}
            </Stack>
          </DialogContent>
          <DialogActions>
            <Button onClick={() => setCatDialog(false)}>إلغاء</Button>
            <Button
              variant="contained"
              disabled={!canMutateAdmin}
              onClick={async () => {
                await executeWithConflictGuard(
                  () => service.saveCategory(catForm, categories, assets),
                  'تم حفظ التصنيف بنجاح'
                );
                setCatDialog(false);
              }}
            >
              حفظ
            </Button>
          </DialogActions>
        </Dialog>

        {/* Dynamic Field Dialog */}
        <Dialog open={fieldDialog} onClose={() => setFieldDialog(false)} fullWidth maxWidth="sm">
          <DialogTitle>
            {fieldForm.id ? 'تعديل حقل ديناميكي' : 'إضافة حقل ديناميكي'}
          </DialogTitle>
          <DialogContent>
            <Stack spacing={2} mt={1}>
              <FormControl fullWidth disabled={Boolean(fieldForm.id)}>
                <InputLabel>التصنيف</InputLabel>
                <Select
                  label="التصنيف"
                  value={fieldForm.category_id}
                  onChange={e => setFieldField('category_id', e.target.value)}
                >
                  {categories.map(c => (
                    <MenuItem key={c.id} value={c.id}>
                      {c.code_prefix} | {c.name}
                    </MenuItem>
                  ))}
                </Select>
              </FormControl>
              <FormControl fullWidth disabled={Boolean(fieldForm.id)}>
                <InputLabel>نطاق الحقل</InputLabel>
                <Select
                  label="نطاق الحقل"
                  value={fieldForm.scope}
                  onChange={e => setFieldField('scope', e.target.value)}
                >
                  {FIELD_SCOPES.map(s => (
                    <MenuItem key={s} value={s}>
                      {s === 'asset' ? 'حقل أصل (مثل قدرة المولد KVA)' : 'حقل سجل تشغيل (مثل عدد النقلات / الأكواب)'}
                    </MenuItem>
                  ))}
                </Select>
              </FormControl>
              <TextField
                label="التسمية الظاهرة (مثل: عدد النقلات) *"
                value={fieldForm.label}
                onChange={e => setFieldField('label', e.target.value)}
              />
              <TextField
                label="المفتاح الداخلي (مثل: trips_count) *"
                value={fieldForm.field_key}
                disabled={Boolean(fieldForm.id && fieldForm.has_historical_values)}
                onChange={e => setFieldField('field_key', e.target.value)}
              />
              <FormControl
                fullWidth
                disabled={Boolean(fieldForm.id && fieldForm.has_historical_values)}
              >
                <InputLabel>نوع الحقل</InputLabel>
                <Select
                  label="نوع الحقل"
                  value={fieldForm.field_type}
                  onChange={e => setFieldField('field_type', e.target.value)}
                >
                  {FIELD_TYPES.map(t => (
                    <MenuItem key={t} value={t}>
                      {t}
                    </MenuItem>
                  ))}
                </Select>
              </FormControl>
              <TextField
                label="الوحدة الاختيارية (مثل: KVA أو م³/ساعة أو نقلة)"
                value={fieldForm.unit || ''}
                onChange={e => setFieldField('unit', e.target.value)}
              />
              <TextField
                type="number"
                label="ترتيب العرض"
                value={fieldForm.sort_order}
                onChange={e => setFieldField('sort_order', e.target.value)}
              />
              {fieldForm.field_type === 'select' && (
                <TextField
                  multiline
                  minRows={3}
                  label="خيارات القائمة المنسدلة (خيار واحد في كل سطر) *"
                  value={fieldOptsText}
                  onChange={e => setFieldOptsText(e.target.value)}
                />
              )}
              <FormControlLabel
                control={
                  <Switch
                    checked={Boolean(fieldForm.is_required)}
                    onChange={e => setFieldField('is_required', e.target.checked)}
                  />
                }
                label="حقل إلزامي"
              />
              <FormControlLabel
                control={
                  <Switch
                    checked={fieldForm.show_in_reports !== false}
                    onChange={e => setFieldField('show_in_reports', e.target.checked)}
                  />
                }
                label="يظهر في التقارير"
              />
              <FormControlLabel
                control={
                  <Switch
                    checked={fieldForm.is_active !== false}
                    onChange={e => setFieldField('is_active', e.target.checked)}
                  />
                }
                label="نشط"
              />
            </Stack>
          </DialogContent>
          <DialogActions>
            <Button onClick={() => setFieldDialog(false)}>إلغاء</Button>
            <Button
              variant="contained"
              disabled={!canMutateAdmin}
              onClick={async () => {
                const parsedOpts = fieldOptsText
                  .split('\n')
                  .map(s => s.trim())
                  .filter(Boolean)
                  .map((label, idx) => ({ label, value_key: `opt_${idx + 1}`, sort_order: idx, is_active: true }));
                await executeWithConflictGuard(
                  () => service.saveCategoryField(fieldForm, parsedOpts, categoryFields),
                  'تم حفظ الحقل الديناميكي'
                );
                setFieldDialog(false);
              }}
            >
              حفظ الحقل
            </Button>
          </DialogActions>
        </Dialog>
      </>
    );
  }

  function setFieldField(k, v) {
    setFieldForm(prev => ({ ...prev, [k]: v }));
  }

  // -------------------- VIEW: ASSETS --------------------
  if (type === 'assets') {
    const filteredAssets = assets.filter(a =>
      [a.asset_code, a.name, a.location, a.notes].join(' ').toLowerCase().includes(q.toLowerCase())
    );
    const assetsPage = pageRows('assets', filteredAssets);
    const activeCatFields = categoryFields
      .filter(f => f.category_id === assetForm.category_id && f.scope === 'asset' && f.is_active)
      .sort((a, b) => a.sort_order - b.sort_order);

    return (
      <>
        {conflictBanner}
        <Stack direction="row" justifyContent="space-between" alignItems="center" mb={3}>
          <Box>
            <Typography variant="h4" fontWeight={800}>
              الأصول والمعدات
            </Typography>
            <Typography color="text.secondary">
              الأصول مرتبة تصاعديًا حسب الكود مع دعم التجاوز والوراثة والأصل الافتراضي لكل تصنيف
            </Typography>
          </Box>
          {isAdmin && (
            <Button
              variant="contained"
              startIcon={<AddRounded />}
              disabled={!canMutateAdmin}
              onClick={() => {
                const firstActiveCat = categories.find(c => c.status === 'active');
                setAssetForm({
                  id: '',
                  version: 1,
                  name: '',
                  category_id: firstActiveCat?.id || '',
                  location: '',
                  status: 'active',
                  notes: '',
                  is_default: false,
                  has_fuel_rate_override: false,
                  fuel_rate_override: '',
                  has_chlorine_consumption_override: false,
                  chlorine_consumption_override: '',
                  has_residual_chlorine_override: false,
                  residual_chlorine_override: '',
                });
                setAssetDynValues({});
                setAssetDialog(true);
              }}
            >
              إضافة أصل جديد
            </Button>
          )}
        </Stack>

        <TextField
          fullWidth
          size="small"
          label="بحث بالكود أو الاسم أو الموقع"
          value={q}
          onChange={e => setQ(e.target.value)}
          sx={{ mb: 2 }}
        />

        <Grid container spacing={2}>
          {assetsPage.rows.map(a => {
            const cat = categories.find(c => c.id === a.category_id);
            const effFuel = effectiveValue(a, cat, 'fuel_rate');
            const effChl = effectiveValue(a, cat, 'chlorine_consumption');
            return (
              <Grid size={{ xs: 12, md: 6, lg: 4 }} key={a.id}>
                <Card
                  data-highlighted={highlightId === a.id ? 'true' : undefined}
                  sx={{ height: '100%', ...(highlightId === a.id ? { outline: 3, outlineColor: 'secondary.main' } : {}) }}
                >
                  <CardContent>
                    <Stack direction="row" justifyContent="space-between" alignItems="flex-start">
                      <Box>
                        <Typography variant="h6" fontWeight={800}>
                          {a.asset_code} — {a.name}
                        </Typography>
                        <Typography variant="body2" color="text.secondary">
                          {cat?.name || '—'} • {a.location || 'بلا موقع'}
                        </Typography>
                      </Box>
                      {isAdmin && (
                        <IconButton
                          size="small"
                          disabled={!canMutateAdmin}
                          onClick={() => {
                            const vals = {};
                            assetFieldValues
                              .filter(v => v.asset_id === a.id)
                              .forEach(v => {
                                vals[v.field_id] =
                                  v.value_option_id ??
                                  v.value_text ??
                                  v.value_number ??
                                  v.value_date ??
                                  v.value_boolean ??
                                  '';
                              });
                            setAssetForm({
                              ...a,
                              fuel_rate_override: a.fuel_rate_override ?? '',
                              chlorine_consumption_override: a.chlorine_consumption_override ?? '',
                              residual_chlorine_override: a.residual_chlorine_override ?? '',
                            });
                            setAssetDynValues(vals);
                            setAssetDialog(true);
                          }}
                        >
                          <EditRounded fontSize="small" />
                        </IconButton>
                      )}
                    </Stack>

                    <Stack direction="row" spacing={1} mt={1.5} flexWrap="wrap" useFlexGap>
                      <Chip
                        size="small"
                        color={a.status === 'active' ? 'success' : 'default'}
                        label={a.status === 'active' ? 'نشط' : 'غير نشط'}
                      />
                      {a.is_default ? (
                        <Chip
                          size="small"
                          color="secondary"
                          icon={<StarRounded />}
                          label="الأصل الافتراضي للتصنيف"
                        />
                      ) : (
                        isAdmin &&
                        a.status === 'active' && (
                          <Button
                            size="small"
                            disabled={!canMutateAdmin}
                            startIcon={<StarBorderRounded />}
                            onClick={() =>
                              executeWithConflictGuard(
                                () => service.setDefault(a.id),
                                'تم تعيين الأصل الافتراضي'
                              )
                            }
                          >
                            تعيين كافتراضي
                          </Button>
                        )
                      )}
                    </Stack>

                    <Box sx={{ mt: 1.5, p: 1.25, borderRadius: 2, bgcolor: 'action.hover' }}>
                      {cat?.supports_fuel && (
                        <Typography variant="body2">
                          معدل الوقود الفعلي: <b>{effFuel ?? 0}</b>{' '}
                          {a.has_fuel_rate_override ? '(تجاوز خاص)' : '(موروث من التصنيف)'}
                        </Typography>
                      )}
                      {cat?.supports_chlorine && (
                        <Typography variant="body2">
                          استهلاك الكلور الفعلي: <b>{effChl ?? 0}</b>{' '}
                          {a.has_chlorine_consumption_override ? '(تجاوز خاص)' : '(موروث)'}
                        </Typography>
                      )}
                      <Typography variant="caption" color="text.secondary">
                        الإصدار: v{a.version || 1}
                      </Typography>
                    </Box>
                  </CardContent>
                </Card>
              </Grid>
            );
          })}
        </Grid>
        <PagedFooter paged={assetsPage} testId="paging-assets" />

        <Dialog open={assetDialog} onClose={() => setAssetDialog(false)} fullWidth maxWidth="sm">
          <DialogTitle>{assetForm.id ? `تعديل الأصل ${assetForm.asset_code}` : 'إضافة أصل جديد'}</DialogTitle>
          <DialogContent>
            <Stack spacing={2} mt={1}>
              <FormControl fullWidth>
                <InputLabel>التصنيف *</InputLabel>
                <Select
                  label="التصنيف *"
                  value={assetForm.category_id}
                  onChange={e => setAssetForm({ ...assetForm, category_id: e.target.value })}
                >
                  {categories
                    .filter(c => c.status === 'active' || c.id === assetForm.category_id)
                    .map(c => (
                      <MenuItem key={c.id} value={c.id}>
                        {c.code_prefix} | {c.name}
                      </MenuItem>
                    ))}
                </Select>
              </FormControl>
              <TextField
                label="اسم الأصل *"
                value={assetForm.name}
                onChange={e => setAssetForm({ ...assetForm, name: e.target.value })}
              />
              <TextField
                label="الموقع النصي"
                value={assetForm.location || ''}
                onChange={e => setAssetForm({ ...assetForm, location: e.target.value })}
              />
              <FormControl fullWidth>
                <InputLabel>الحالة</InputLabel>
                <Select
                  label="الحالة"
                  value={assetForm.status}
                  onChange={e => setAssetForm({ ...assetForm, status: e.target.value })}
                >
                  <MenuItem value="active">نشط</MenuItem>
                  <MenuItem value="inactive">غير نشط (معطل)</MenuItem>
                </Select>
              </FormControl>
              <FormControlLabel
                control={
                  <Switch
                    checked={Boolean(assetForm.has_fuel_rate_override)}
                    onChange={e =>
                      setAssetForm({ ...assetForm, has_fuel_rate_override: e.target.checked })
                    }
                  />
                }
                label="تجاوز معدل استهلاك الوقود الافتراضي للتصنيف"
              />
              {assetForm.has_fuel_rate_override && (
                <TextField
                  type="number"
                  label="قيمة تجاوز معدل الوقود"
                  value={assetForm.fuel_rate_override}
                  onChange={e => setAssetForm({ ...assetForm, fuel_rate_override: e.target.value })}
                />
              )}
              <FormControlLabel
                control={
                  <Switch
                    checked={Boolean(assetForm.has_chlorine_consumption_override)}
                    onChange={e =>
                      setAssetForm({
                        ...assetForm,
                        has_chlorine_consumption_override: e.target.checked,
                      })
                    }
                  />
                }
                label="تجاوز قيمة استهلاك الكلور الافتراضية"
              />
              {assetForm.has_chlorine_consumption_override && (
                <TextField
                  type="number"
                  label="قيمة تجاوز استهلاك الكلور"
                  value={assetForm.chlorine_consumption_override}
                  onChange={e =>
                    setAssetForm({ ...assetForm, chlorine_consumption_override: e.target.value })
                  }
                />
              )}
              <TextField
                multiline
                minRows={2}
                label="ملاحظات"
                value={assetForm.notes || ''}
                onChange={e => setAssetForm({ ...assetForm, notes: e.target.value })}
              />
              {activeCatFields.map(f => (
                <DynamicFieldInput
                  key={f.id}
                  field={f}
                  options={fieldOptions}
                  value={assetDynValues[f.id]}
                  onChange={val => setAssetDynValues({ ...assetDynValues, [f.id]: val })}
                />
              ))}
            </Stack>
          </DialogContent>
          <DialogActions>
            <Button onClick={() => setAssetDialog(false)}>إلغاء</Button>
            <Button
              variant="contained"
              disabled={!canMutateAdmin}
              onClick={async () => {
                if (assetForm.id) {
                  await executeWithConflictGuard(
                    () =>
                      service.updateAsset(
                        assetForm.id,
                        assetForm.version,
                        assetForm,
                        assetDynValues
                      ),
                    'تم تحديث الأصل بنجاح'
                  );
                } else {
                  await executeWithConflictGuard(
                    () => service.createAsset(assetForm, assetDynValues),
                    'تم إنشاء الأصل وتوليد الكود تلقائيًا'
                  );
                }
                setAssetDialog(false);
              }}
            >
              حفظ الأصل
            </Button>
          </DialogActions>
        </Dialog>
      </>
    );
  }

  // -------------------- VIEW: OPERATORS --------------------
  if (type === 'operators') {
    const filteredOps = operators.filter(o =>
      [o.name, o.phone, o.notes].join(' ').toLowerCase().includes(q.toLowerCase())
    );
    const opsPage = pageRows('operators', filteredOps);
    return (
      <>
        <Stack direction="row" justifyContent="space-between" alignItems="center" mb={3}>
          <Typography variant="h4" fontWeight={800}>
            المشغلون
          </Typography>
          {isAdmin && (
            <Button
              variant="contained"
              startIcon={<AddRounded />}
              disabled={!canMutateAdmin}
              onClick={() => {
                setOpForm({ id: '', name: '', phone: '', notes: '', status: 'active' });
                setOpDialog(true);
              }}
            >
              إضافة مشغل
            </Button>
          )}
        </Stack>
        <TextField
          fullWidth
          size="small"
          label="بحث في المشغلين"
          value={q}
          onChange={e => setQ(e.target.value)}
          sx={{ mb: 2 }}
        />
        <TableContainer component={Paper}>
          <Table size="small">
            <TableHead>
              <TableRow>
                <TableCell>الاسم</TableCell>
                <TableCell>رقم الهاتف</TableCell>
                <TableCell>الملاحظات</TableCell>
                <TableCell>الحالة</TableCell>
                {isAdmin && <TableCell>إجراءات</TableCell>}
              </TableRow>
            </TableHead>
            <TableBody>
              {opsPage.rows.map(op => (
                <TableRow key={op.id} selected={highlightId === op.id}>
                  <TableCell fontWeight={700}>{op.name}</TableCell>
                  <TableCell>{op.phone || '—'}</TableCell>
                  <TableCell>{op.notes || '—'}</TableCell>
                  <TableCell>
                    <Chip
                      size="small"
                      color={op.status === 'active' ? 'success' : 'default'}
                      label={op.status === 'active' ? 'نشط' : 'غير نشط'}
                    />
                  </TableCell>
                  {isAdmin && (
                    <TableCell>
                      <IconButton
                        size="small"
                        disabled={!canMutateAdmin}
                        onClick={() => {
                          setOpForm({ ...op });
                          setOpDialog(true);
                        }}
                      >
                        <EditRounded fontSize="small" />
                      </IconButton>
                    </TableCell>
                  )}
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </TableContainer>
        <PagedFooter paged={opsPage} testId="paging-operators" />

        <Dialog open={opDialog} onClose={() => setOpDialog(false)} fullWidth maxWidth="xs">
          <DialogTitle>{opForm.id ? 'تعديل مشغل' : 'إضافة مشغل'}</DialogTitle>
          <DialogContent>
            <Stack spacing={2} mt={1}>
              <TextField
                label="اسم المشغل *"
                value={opForm.name}
                onChange={e => setOpForm({ ...opForm, name: e.target.value })}
              />
              <TextField
                label="رقم الهاتف"
                value={opForm.phone || ''}
                onChange={e => setOpForm({ ...opForm, phone: e.target.value })}
              />
              <TextField
                label="ملاحظات"
                value={opForm.notes || ''}
                onChange={e => setOpForm({ ...opForm, notes: e.target.value })}
              />
              <FormControl fullWidth>
                <InputLabel>الحالة</InputLabel>
                <Select
                  label="الحالة"
                  value={opForm.status}
                  onChange={e => setOpForm({ ...opForm, status: e.target.value })}
                >
                  <MenuItem value="active">نشط</MenuItem>
                  <MenuItem value="inactive">غير نشط</MenuItem>
                </Select>
              </FormControl>
            </Stack>
          </DialogContent>
          <DialogActions>
            <Button onClick={() => setOpDialog(false)}>إلغاء</Button>
            <Button
              variant="contained"
              disabled={!canMutateAdmin}
              onClick={async () => {
                await executeWithConflictGuard(
                  () => service.saveOperator(opForm),
                  'تم حفظ بيانات المشغل'
                );
                setOpDialog(false);
              }}
            >
              حفظ
            </Button>
          </DialogActions>
        </Dialog>
      </>
    );
  }

  // -------------------- VIEW: OPERATION LOGS (Section 9) --------------------
  if (type === 'operation_logs') {
    const catAssets = assets.filter(a => a.category_id === selectedCatId);
    const activeAsset = assets.find(a => a.id === selectedAssetId) || null;
    const activeCategory = categories.find(c => c.id === activeAsset?.category_id) || null;

    const assetLogs = operationLogs
      .filter(l => l.asset_id === selectedAssetId)
      .sort((a, b) => b.operation_date.localeCompare(a.operation_date));
    const logsPage = pageRows('operation_logs', assetLogs, selectedAssetId);

    const latestAssetLog = assetLogs[0] || null;
    const dateRule = getOperationDateRule(
      operationLogs,
      selectedAssetId,
      activeCategory,
      opLogForm.id || null
    );

    const opFields = categoryFields
      .filter(
        f => f.category_id === activeCategory?.id && f.scope === 'operation' && f.is_active
      )
      .sort((a, b) => a.sort_order - b.sort_order);

    const prevRead =
      activeCategory?.uses_meter
        ? dateRule.prev
          ? dateRule.prev.current_reading
          : opLogForm.previous_reading
        : null;
    const computedUsage =
      activeCategory?.uses_meter && opLogForm.current_reading !== ''
        ? opLogForm.record_type === 'meter_reset' && Number(opLogForm.current_reading) < Number(prevRead || 0)
          ? 0
          : roundNum(Number(opLogForm.current_reading || 0) - Number(prevRead || 0))
        : null;
    const effRate = activeCategory?.supports_fuel
      ? effectiveValue(activeAsset, activeCategory, 'fuel_rate')
      : 0;
    const computedFuel =
      activeCategory?.supports_fuel && activeCategory?.uses_meter && computedUsage !== null && computedUsage >= 0
        ? roundNum(computedUsage * Number(effRate || 0))
        : 0;

    return (
      <>
        {conflictBanner}
        <Typography variant="h4" fontWeight={800} mb={1}>
          سجلات التشغيل
        </Typography>
        <Typography color="text.secondary" mb={3}>
          اختر التصنيف ثم الأصل لعرض سجلاته وإحصاءاته وإدخال قراءة التشغيل اليومية
        </Typography>

        <Paper sx={{ p: 2.5, mb: 3 }}>
          <Grid container spacing={2}>
            <Grid size={{ xs: 12, md: 6 }}>
              <FormControl fullWidth size="small">
                <InputLabel>1. اختر التصنيف</InputLabel>
                <Select
                  label="1. اختر التصنيف"
                  value={selectedCatId}
                  onChange={e => handleSelectCategoryForLogs(e.target.value)}
                >
                  {categories.map(c => (
                    <MenuItem key={c.id} value={c.id}>
                      {c.code_prefix} | {c.name}
                    </MenuItem>
                  ))}
                </Select>
              </FormControl>
            </Grid>
            <Grid size={{ xs: 12, md: 6 }}>
              <FormControl fullWidth size="small">
                <InputLabel>2. اختر الأصل التابع للتصنيف (مرتب حسب الكود)</InputLabel>
                <Select
                  label="2. اختر الأصل التابع للتصنيف (مرتب حسب الكود)"
                  value={selectedAssetId}
                  onChange={e => setSelectedAssetId(e.target.value)}
                >
                  {catAssets.map(a => (
                    <MenuItem key={a.id} value={a.id}>
                      {a.asset_code} | {a.name} {a.is_default ? '★ (افتراضي)' : ''}
                    </MenuItem>
                  ))}
                </Select>
              </FormControl>
            </Grid>
          </Grid>
        </Paper>

        {activeAsset && activeCategory && canOperate && (
          <Paper sx={{ p: 2.5, mb: 3 }}>
            <Typography variant="h6" mb={2}>
              {opLogForm.id
                ? `تعديل آخر سجل تشغيل للأصل ${activeAsset.asset_code}`
                : `إضافة سجل تشغيل للأصل ${activeAsset.asset_code}`}
            </Typography>
            {!opLogForm.id && dateRule.blocked && (
              <Alert severity="warning" sx={{ mb: 2 }}>
                يوجد سجل بتاريخ اليوم لهذا الأصل، ولا يمكن إضافة سجل جديد حتى اليوم التالي.
              </Alert>
            )}
            <Grid container spacing={2}>
              <Grid size={{ xs: 12, sm: 4 }}>
                <TextField
                  fullWidth
                  size="small"
                  type="date"
                  label="التاريخ *"
                  InputLabelProps={{ shrink: true }}
                  inputProps={{ min: dateRule.min || undefined, max: dateRule.max }}
                  value={opLogForm.operation_date || dateRule.defaultDate}
                  onChange={e => setOpLogForm({ ...opLogForm, operation_date: e.target.value })}
                />
              </Grid>
              <Grid size={{ xs: 12, sm: 4 }}>
                <FormControl fullWidth size="small">
                  <InputLabel>المشغل</InputLabel>
                  <Select
                    label="المشغل"
                    value={opLogForm.operator_id}
                    onChange={e => setOpLogForm({ ...opLogForm, operator_id: e.target.value })}
                  >
                    <MenuItem value="">— اختياري —</MenuItem>
                    {operators
                      .filter(o => o.status === 'active' || o.id === opLogForm.operator_id)
                      .map(o => (
                        <MenuItem key={o.id} value={o.id}>
                          {o.name}
                        </MenuItem>
                      ))}
                  </Select>
                </FormControl>
              </Grid>
              {activeCategory.uses_meter && (
                <>
                  <Grid size={{ xs: 12, sm: 4 }}>
                    <FormControl fullWidth size="small">
                      <InputLabel>نوع السجل</InputLabel>
                      <Select
                        label="نوع السجل"
                        value={opLogForm.record_type}
                        onChange={e => setOpLogForm({ ...opLogForm, record_type: e.target.value })}
                      >
                        <MenuItem value="daily">سجل يومي</MenuItem>
                        <MenuItem value="meter_reset">تغيير عداد</MenuItem>
                      </Select>
                    </FormControl>
                  </Grid>
                  <Grid size={{ xs: 12, sm: 4 }}>
                    <TextField
                      fullWidth
                      size="small"
                      type="number"
                      label={`القراءة السابقة (${activeCategory.meter_unit})`}
                      value={prevRead ?? ''}
                      disabled={Boolean(dateRule.prev)}
                      onChange={e =>
                        setOpLogForm({ ...opLogForm, previous_reading: e.target.value })
                      }
                    />
                  </Grid>
                  <Grid size={{ xs: 12, sm: 4 }}>
                    <TextField
                      fullWidth
                      size="small"
                      type="number"
                      label={`القراءة الحالية (${activeCategory.meter_unit}) *`}
                      value={opLogForm.current_reading}
                      onChange={e =>
                        setOpLogForm({ ...opLogForm, current_reading: e.target.value })
                      }
                    />
                  </Grid>
                  <Grid size={{ xs: 12, sm: 4 }}>
                    <TextField
                      fullWidth
                      size="small"
                      disabled
                      label={`فرق القراءة (${activeCategory.meter_unit})`}
                      value={computedUsage ?? '—'}
                    />
                  </Grid>
                </>
              )}
              {activeCategory.supports_fuel && activeCategory.uses_meter && (
                <Grid size={{ xs: 12, sm: 4 }}>
                  <TextField
                    fullWidth
                    size="small"
                    disabled
                    label={`استهلاك الوقود المحسوب (${activeCategory.fuel_unit || 'لتر'})`}
                    value={computedFuel}
                  />
                </Grid>
              )}
              {activeCategory.supports_chlorine && (
                <>
                  <Grid size={{ xs: 12, sm: 4 }}>
                    <TextField
                      fullWidth
                      size="small"
                      type="number"
                      label={`استهلاك الكلور (${activeCategory.chlorine_unit || 'كجم'})`}
                      value={
                        opLogForm.chlorine_consumed !== ''
                          ? opLogForm.chlorine_consumed
                          : effectiveValue(activeAsset, activeCategory, 'chlorine_consumption') ?? ''
                      }
                      onChange={e =>
                        setOpLogForm({ ...opLogForm, chlorine_consumed: e.target.value })
                      }
                    />
                  </Grid>
                  <Grid size={{ xs: 12, sm: 4 }}>
                    <TextField
                      fullWidth
                      size="small"
                      type="number"
                      label="نسبة الكلور العالقة في المياه"
                      value={
                        opLogForm.residual_chlorine !== ''
                          ? opLogForm.residual_chlorine
                          : effectiveValue(activeAsset, activeCategory, 'residual_chlorine') ?? ''
                      }
                      onChange={e =>
                        setOpLogForm({ ...opLogForm, residual_chlorine: e.target.value })
                      }
                    />
                  </Grid>
                </>
              )}
              {opFields.map(df => (
                <Grid size={{ xs: 12, sm: 4 }} key={df.id}>
                  <DynamicFieldInput
                    field={df}
                    options={fieldOptions}
                    value={opDynValues[df.id]}
                    onChange={val => setOpDynValues({ ...opDynValues, [df.id]: val })}
                  />
                </Grid>
              ))}
              <Grid size={{ xs: 12 }}>
                <TextField
                  fullWidth
                  size="small"
                  label="ملاحظات"
                  value={opLogForm.notes}
                  onChange={e => setOpLogForm({ ...opLogForm, notes: e.target.value })}
                />
              </Grid>
              <Grid size={{ xs: 12 }}>
                <Stack direction="row" spacing={1}>
                  <Button
                    variant="contained"
                    disabled={
                      !canMutateOperate ||
                      activeAsset.status !== 'active' ||
                      (!opLogForm.id && dateRule.blocked)
                    }
                    onClick={async () => {
                      await executeWithConflictGuard(
                        () =>
                          service.saveOperation(
                            {
                              ...opLogForm,
                              asset_id: activeAsset.id,
                              operation_date: opLogForm.operation_date || dateRule.defaultDate,
                              previous_reading: prevRead,
                            },
                            opDynValues
                          ),
                        opLogForm.id ? 'تم تحديث سجل التشغيل' : 'تم حفظ سجل التشغيل'
                      );
                      setOpLogForm({
                        id: '',
                        version: 1,
                        operation_date: '',
                        record_type: 'daily',
                        operator_id: '',
                        previous_reading: '',
                        current_reading: '',
                        chlorine_consumed: '',
                        residual_chlorine: '',
                        notes: '',
                      });
                      setOpDynValues({});
                    }}
                  >
                    {opLogForm.id ? 'تحديث آخر سجل' : 'حفظ سجل التشغيل'}
                  </Button>
                  {opLogForm.id && (
                    <Button
                      onClick={() => {
                        setOpLogForm({
                          id: '',
                          version: 1,
                          operation_date: '',
                          record_type: 'daily',
                          operator_id: '',
                          previous_reading: '',
                          current_reading: '',
                          chlorine_consumed: '',
                          residual_chlorine: '',
                          notes: '',
                        });
                        setOpDynValues({});
                      }}
                    >
                      إلغاء التعديل
                    </Button>
                  )}
                </Stack>
              </Grid>
            </Grid>
          </Paper>
        )}

        <TableContainer component={Paper}>
          <Table size="small">
            <TableHead>
              <TableRow>
                <TableCell>التاريخ</TableCell>
                <TableCell>المشغل</TableCell>
                {activeCategory?.uses_meter && <TableCell>السابقة</TableCell>}
                {activeCategory?.uses_meter && <TableCell>الحالية</TableCell>}
                {activeCategory?.uses_meter && <TableCell>الفرق ({activeCategory.meter_unit})</TableCell>}
                {activeCategory?.supports_fuel && <TableCell>الوقود</TableCell>}
                {activeCategory?.supports_chlorine && <TableCell>الكلور</TableCell>}
                <TableCell>الملاحظات</TableCell>
                <TableCell>إجراءات</TableCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {logsPage.rows.map(l => {
                const isLast = latestAssetLog?.id === l.id;
                const op = operators.find(o => o.id === l.operator_id);
                return (
                  <TableRow
                    key={l.id}
                    selected={highlightId === l.id}
                  >
                    <TableCell>{l.operation_date}</TableCell>
                    <TableCell>{op?.name || '—'}</TableCell>
                    {activeCategory?.uses_meter && <TableCell>{l.previous_reading ?? '—'}</TableCell>}
                    {activeCategory?.uses_meter && <TableCell>{l.current_reading ?? '—'}</TableCell>}
                    {activeCategory?.uses_meter && <TableCell><b>{l.usage_value ?? '—'}</b></TableCell>}
                    {activeCategory?.supports_fuel && <TableCell>{l.fuel_consumed ?? 0}</TableCell>}
                    {activeCategory?.supports_chlorine && <TableCell>{l.chlorine_consumed ?? 0}</TableCell>}
                    <TableCell>{l.notes || '—'}</TableCell>
                    <TableCell>
                      {isLast && canOperate ? (
                        <Stack direction="row" spacing={0.5}>
                          <IconButton
                            size="small"
                            disabled={!canMutateOperate}
                            onClick={() => {
                              const vals = {};
                              operationLogValues
                                .filter(v => v.operation_log_id === l.id)
                                .forEach(v => {
                                  vals[v.field_id] =
                                    v.value_option_id ??
                                    v.value_text ??
                                    v.value_number ??
                                    v.value_date ??
                                    v.value_boolean ??
                                    '';
                                });
                              setOpLogForm({
                                id: l.id,
                                version: l.version,
                                operation_date: l.operation_date,
                                record_type: l.record_type || 'daily',
                                operator_id: l.operator_id || '',
                                previous_reading: l.previous_reading ?? '',
                                current_reading: l.current_reading ?? '',
                                chlorine_consumed: l.chlorine_consumed ?? '',
                                residual_chlorine: l.residual_chlorine ?? '',
                                notes: l.notes || '',
                              });
                              setOpDynValues(vals);
                            }}
                          >
                            <EditRounded fontSize="small" />
                          </IconButton>
                          <IconButton
                            size="small"
                            color="error"
                            disabled={!canMutateOperate}
                            onClick={() =>
                              executeWithConflictGuard(
                                () => service.deleteOperation(l.id, l.version),
                                'تم حذف آخر سجل تشغيل'
                              )
                            }
                          >
                            <DeleteRounded fontSize="small" />
                          </IconButton>
                        </Stack>
                      ) : (
                        <Tooltip title="السجلات السابقة للقراءة فقط">
                          <span>🔒</span>
                        </Tooltip>
                      )}
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </TableContainer>
        <PagedFooter paged={logsPage} testId="paging-operation-logs" />
      </>
    );
  }

  // -------------------- VIEW: FUEL TRANSACTIONS (Section 10) --------------------
  if (type === 'fuel_transactions') {
    const eligibleAssets = assets.filter(a => {
      const c = categories.find(x => x.id === a.category_id);
      return c?.supports_fuel;
    });

    const sortedFuel = [...fuelTransactions].sort(
      (a, b) =>
        b.transaction_date.localeCompare(a.transaction_date) ||
        String(b.created_at).localeCompare(String(a.created_at))
    );
    const fuelPage = pageRows('fuel_transactions', sortedFuel, '');

    const latestByAsset = new Map();
    for (const tx of sortedFuel) {
      if (!latestByAsset.has(tx.asset_id)) latestByAsset.set(tx.asset_id, tx.id);
    }

    return (
      <>
        {conflictBanner}
        <Typography variant="h4" fontWeight={800} mb={1}>
          حركات الوقود والأرصدة النظرية
        </Typography>
        <Typography color="text.secondary" mb={3}>
          الأرصدة النظرية لكل أصل ونوع وقود، وحركات التزويد والتسويات (بلا أسعار أو تكاليف مالية)
        </Typography>

        <Grid container spacing={2} mb={3}>
          {eligibleAssets.map(a =>
            fuelTypes.map(ft => {
              const bal = calculateFuelBalance(
                a.id,
                ft.id,
                fuelTransactions,
                operationLogs,
                fuelTypes
              );
              return (
                <Grid size={{ xs: 12, sm: 6, md: 3 }} key={`${a.id}-${ft.id}`}>
                  <Card>
                    <CardContent>
                      <Typography variant="subtitle2" color="text.secondary">
                        {a.asset_code} — {a.name} ({ft.name})
                      </Typography>
                      <Typography variant="h5" fontWeight={800} mt={0.5}>
                        {bal} {ft.unit}
                      </Typography>
                    </CardContent>
                  </Card>
                </Grid>
              );
            })
          )}
        </Grid>

        {canOperate && (
          <Paper sx={{ p: 2.5, mb: 3 }}>
            <Typography variant="h6" mb={2}>
              {fuelForm.id ? 'تعديل آخر حركة وقود' : 'إضافة حركة وقود'}
            </Typography>
            <Grid container spacing={2}>
              <Grid size={{ xs: 12, sm: 4 }}>
                <FormControl fullWidth size="small" disabled={Boolean(fuelForm.id)}>
                  <InputLabel>الأصل المؤهل *</InputLabel>
                  <Select
                    label="الأصل المؤهل *"
                    value={fuelForm.asset_id}
                    onChange={e => setFuelForm({ ...fuelForm, asset_id: e.target.value })}
                  >
                    {eligibleAssets
                      .filter(a => a.status === 'active' || a.id === fuelForm.asset_id)
                      .map(a => (
                        <MenuItem key={a.id} value={a.id}>
                          {a.asset_code} | {a.name}
                        </MenuItem>
                      ))}
                  </Select>
                </FormControl>
              </Grid>
              <Grid size={{ xs: 12, sm: 4 }}>
                <FormControl fullWidth size="small">
                  <InputLabel>نوع الوقود *</InputLabel>
                  <Select
                    label="نوع الوقود *"
                    value={fuelForm.fuel_type_id}
                    onChange={e => setFuelForm({ ...fuelForm, fuel_type_id: e.target.value })}
                  >
                    {fuelTypes
                      .filter(ft => ft.status === 'active' || ft.id === fuelForm.fuel_type_id)
                      .map(ft => (
                        <MenuItem key={ft.id} value={ft.id}>
                          {ft.name} ({ft.unit})
                        </MenuItem>
                      ))}
                  </Select>
                </FormControl>
              </Grid>
              <Grid size={{ xs: 12, sm: 4 }}>
                <FormControl fullWidth size="small">
                  <InputLabel>نوع الحركة *</InputLabel>
                  <Select
                    label="نوع الحركة *"
                    value={fuelForm.transaction_type}
                    onChange={e => setFuelForm({ ...fuelForm, transaction_type: e.target.value })}
                  >
                    {Object.entries(FUEL_TX_TYPES).map(([k, v]) => (
                      <MenuItem key={k} value={k}>
                        {v}
                      </MenuItem>
                    ))}
                  </Select>
                </FormControl>
              </Grid>
              <Grid size={{ xs: 6, sm: 3 }}>
                <TextField
                  fullWidth
                  size="small"
                  type="date"
                  label="التاريخ *"
                  InputLabelProps={{ shrink: true }}
                  value={fuelForm.transaction_date}
                  onChange={e => setFuelForm({ ...fuelForm, transaction_date: e.target.value })}
                />
              </Grid>
              <Grid size={{ xs: 6, sm: 3 }}>
                <TextField
                  fullWidth
                  size="small"
                  type="number"
                  label="الكمية *"
                  value={fuelForm.quantity}
                  onChange={e => setFuelForm({ ...fuelForm, quantity: e.target.value })}
                />
              </Grid>
              <Grid size={{ xs: 6, sm: 3 }}>
                <TextField
                  fullWidth
                  size="small"
                  label="المورد (نص حر)"
                  value={fuelForm.supplier}
                  onChange={e => setFuelForm({ ...fuelForm, supplier: e.target.value })}
                />
              </Grid>
              <Grid size={{ xs: 6, sm: 3 }}>
                <TextField
                  fullWidth
                  size="small"
                  label="رقم الفاتورة"
                  value={fuelForm.invoice_number}
                  onChange={e => setFuelForm({ ...fuelForm, invoice_number: e.target.value })}
                />
              </Grid>
              {fuelForm.transaction_type !== 'supply' && (
                <Grid size={{ xs: 12, sm: 6 }}>
                  <TextField
                    fullWidth
                    size="small"
                    label="سبب التسوية (إلزامي للتسويات) *"
                    value={fuelForm.adjustment_reason}
                    onChange={e => setFuelForm({ ...fuelForm, adjustment_reason: e.target.value })}
                  />
                </Grid>
              )}
              <Grid size={{ xs: 12, sm: fuelForm.transaction_type !== 'supply' ? 6 : 12 }}>
                <TextField
                  fullWidth
                  size="small"
                  label="ملاحظات"
                  value={fuelForm.notes}
                  onChange={e => setFuelForm({ ...fuelForm, notes: e.target.value })}
                />
              </Grid>
              <Grid size={{ xs: 12 }}>
                <Button
                  variant="contained"
                  disabled={!canMutateOperate}
                  onClick={async () => {
                    await executeWithConflictGuard(
                      () => service.saveFuel(fuelForm),
                      'تم حفظ حركة الوقود'
                    );
                    setFuelForm({
                      id: '',
                      version: 1,
                      asset_id: '',
                      fuel_type_id: '',
                      transaction_date: localTodayISO(),
                      transaction_type: 'supply',
                      quantity: '',
                      operator_id: '',
                      supplier: '',
                      invoice_number: '',
                      adjustment_reason: '',
                      notes: '',
                    });
                  }}
                >
                  {fuelForm.id ? 'تحديث الحركة' : 'حفظ حركة الوقود'}
                </Button>
              </Grid>
            </Grid>
          </Paper>
        )}

        <TableContainer component={Paper}>
          <Table size="small">
            <TableHead>
              <TableRow>
                <TableCell>التاريخ</TableCell>
                <TableCell>الأصل</TableCell>
                <TableCell>نوع الوقود</TableCell>
                <TableCell>نوع الحركة</TableCell>
                <TableCell>الكمية</TableCell>
                <TableCell>المورد / الفاتورة / السبب</TableCell>
                <TableCell>إجراءات</TableCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {fuelPage.rows.map(tx => {
                const a = assets.find(x => x.id === tx.asset_id);
                const ft = fuelTypes.find(x => x.id === tx.fuel_type_id);
                const isLast = latestByAsset.get(tx.asset_id) === tx.id;
                return (
                  <TableRow key={tx.id} selected={highlightId === tx.id}>
                    <TableCell>{tx.transaction_date}</TableCell>
                    <TableCell>
                      {a?.asset_code} | {a?.name}
                    </TableCell>
                    <TableCell>{ft?.name || '—'}</TableCell>
                    <TableCell>{FUEL_TX_TYPES[tx.transaction_type] || tx.transaction_type}</TableCell>
                    <TableCell>
                      <b>{tx.quantity}</b> {ft?.unit}
                    </TableCell>
                    <TableCell>
                      {[tx.supplier, tx.invoice_number, tx.adjustment_reason, tx.notes]
                        .filter(Boolean)
                        .join(' | ') || '—'}
                    </TableCell>
                    <TableCell>
                      {isLast && canOperate ? (
                        <Stack direction="row" spacing={0.5}>
                          <IconButton
                            size="small"
                            disabled={!canMutateOperate}
                            onClick={() => setFuelForm({ ...tx, adjustment_reason: tx.adjustment_reason || '' })}
                          >
                            <EditRounded fontSize="small" />
                          </IconButton>
                          <IconButton
                            size="small"
                            color="error"
                            disabled={!canMutateOperate}
                            onClick={() =>
                              executeWithConflictGuard(
                                () => service.deleteFuel(tx.id, tx.version),
                                'تم حذف آخر حركة وقود'
                              )
                            }
                          >
                            <DeleteRounded fontSize="small" />
                          </IconButton>
                        </Stack>
                      ) : (
                        '🔒'
                      )}
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </TableContainer>
        <PagedFooter paged={fuelPage} testId="paging-fuel" />
      </>
    );
  }

  // -------------------- VIEW: CHLORINE TRANSACTIONS (Section 11) --------------------
  if (type === 'chlorine_transactions') {
    const eligibleAssets = assets.filter(a => {
      const c = categories.find(x => x.id === a.category_id);
      return c?.supports_chlorine;
    });

    const sortedChl = [...chlorineTransactions].sort(
      (a, b) =>
        b.transaction_date.localeCompare(a.transaction_date) ||
        String(b.created_at).localeCompare(String(a.created_at))
    );
    const chlPage = pageRows('chlorine_transactions', sortedChl, '');

    const latestByAsset = new Map();
    for (const tx of sortedChl) {
      if (!latestByAsset.has(tx.asset_id)) latestByAsset.set(tx.asset_id, tx.id);
    }

    return (
      <>
        {conflictBanner}
        <Typography variant="h4" fontWeight={800} mb={1}>
          حركات الكلور والأرصدة النظرية
        </Typography>
        <Typography color="text.secondary" mb={3}>
          إدارة استلام وتسويات الكلور للأصول المؤهلة وحساب الرصيد النظري تلقائيًا
        </Typography>

        <Grid container spacing={2} mb={3}>
          {eligibleAssets.map(a => {
            const c = categories.find(x => x.id === a.category_id);
            const bal = calculateChlorineBalance(a.id, chlorineTransactions, operationLogs);
            return (
              <Grid size={{ xs: 12, sm: 6, md: 3 }} key={a.id}>
                <Card>
                  <CardContent>
                    <Typography variant="subtitle2" color="text.secondary">
                      {a.asset_code} — {a.name}
                    </Typography>
                    <Typography variant="h5" fontWeight={800} mt={0.5}>
                      {bal} {c?.chlorine_unit || 'كجم'}
                    </Typography>
                  </CardContent>
                </Card>
              </Grid>
            );
          })}
        </Grid>

        {canOperate && (
          <Paper sx={{ p: 2.5, mb: 3 }}>
            <Typography variant="h6" mb={2}>
              {chlForm.id ? 'تعديل آخر حركة كلور' : 'إضافة حركة كلور'}
            </Typography>
            <Grid container spacing={2}>
              <Grid size={{ xs: 12, sm: 4 }}>
                <FormControl fullWidth size="small" disabled={Boolean(chlForm.id)}>
                  <InputLabel>الأصل المؤهل للكلور *</InputLabel>
                  <Select
                    label="الأصل المؤهل للكلور *"
                    value={chlForm.asset_id}
                    onChange={e => setChlForm({ ...chlForm, asset_id: e.target.value })}
                  >
                    {eligibleAssets
                      .filter(a => a.status === 'active' || a.id === chlForm.asset_id)
                      .map(a => (
                        <MenuItem key={a.id} value={a.id}>
                          {a.asset_code} | {a.name}
                        </MenuItem>
                      ))}
                  </Select>
                </FormControl>
              </Grid>
              <Grid size={{ xs: 12, sm: 4 }}>
                <FormControl fullWidth size="small">
                  <InputLabel>نوع الحركة *</InputLabel>
                  <Select
                    label="نوع الحركة *"
                    value={chlForm.transaction_type}
                    onChange={e => setChlForm({ ...chlForm, transaction_type: e.target.value })}
                  >
                    {Object.entries(CHLORINE_TX_TYPES).map(([k, v]) => (
                      <MenuItem key={k} value={k}>
                        {v}
                      </MenuItem>
                    ))}
                  </Select>
                </FormControl>
              </Grid>
              <Grid size={{ xs: 6, sm: 2 }}>
                <TextField
                  fullWidth
                  size="small"
                  type="date"
                  label="التاريخ *"
                  InputLabelProps={{ shrink: true }}
                  value={chlForm.transaction_date}
                  onChange={e => setChlForm({ ...chlForm, transaction_date: e.target.value })}
                />
              </Grid>
              <Grid size={{ xs: 6, sm: 2 }}>
                <TextField
                  fullWidth
                  size="small"
                  type="number"
                  label="الكمية *"
                  value={chlForm.quantity}
                  onChange={e => setChlForm({ ...chlForm, quantity: e.target.value })}
                />
              </Grid>
              <Grid size={{ xs: 12, sm: 4 }}>
                <TextField
                  fullWidth
                  size="small"
                  label="المورد (نص حر)"
                  value={chlForm.supplier}
                  onChange={e => setChlForm({ ...chlForm, supplier: e.target.value })}
                />
              </Grid>
              {chlForm.transaction_type !== 'receipt' && (
                <Grid size={{ xs: 12, sm: 4 }}>
                  <TextField
                    fullWidth
                    size="small"
                    label="سبب التسوية *"
                    value={chlForm.adjustment_reason}
                    onChange={e => setChlForm({ ...chlForm, adjustment_reason: e.target.value })}
                  />
                </Grid>
              )}
              <Grid size={{ xs: 12, sm: 4 }}>
                <TextField
                  fullWidth
                  size="small"
                  label="ملاحظات"
                  value={chlForm.notes}
                  onChange={e => setChlForm({ ...chlForm, notes: e.target.value })}
                />
              </Grid>
              <Grid size={{ xs: 12 }}>
                <Button
                  variant="contained"
                  disabled={!canMutateOperate}
                  onClick={async () => {
                    await executeWithConflictGuard(
                      () => service.saveChlorine(chlForm),
                      'تم حفظ حركة الكلور'
                    );
                    setChlForm({
                      id: '',
                      version: 1,
                      asset_id: '',
                      transaction_date: localTodayISO(),
                      transaction_type: 'receipt',
                      quantity: '',
                      supplier: '',
                      adjustment_reason: '',
                      notes: '',
                    });
                  }}
                >
                  {chlForm.id ? 'تحديث الحركة' : 'حفظ حركة الكلور'}
                </Button>
              </Grid>
            </Grid>
          </Paper>
        )}

        <TableContainer component={Paper}>
          <Table size="small">
            <TableHead>
              <TableRow>
                <TableCell>التاريخ</TableCell>
                <TableCell>الأصل</TableCell>
                <TableCell>نوع الحركة</TableCell>
                <TableCell>الكمية</TableCell>
                <TableCell>المورد / السبب / الملاحظات</TableCell>
                <TableCell>إجراءات</TableCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {chlPage.rows.map(tx => {
                const a = assets.find(x => x.id === tx.asset_id);
                const c = categories.find(x => x.id === a?.category_id);
                const isLast = latestByAsset.get(tx.asset_id) === tx.id;
                return (
                  <TableRow key={tx.id} selected={highlightId === tx.id}>
                    <TableCell>{tx.transaction_date}</TableCell>
                    <TableCell>
                      {a?.asset_code} | {a?.name}
                    </TableCell>
                    <TableCell>{CHLORINE_TX_TYPES[tx.transaction_type] || tx.transaction_type}</TableCell>
                    <TableCell>
                      <b>{tx.quantity}</b> {c?.chlorine_unit || 'كجم'}
                    </TableCell>
                    <TableCell>
                      {[tx.supplier, tx.adjustment_reason, tx.notes].filter(Boolean).join(' | ') || '—'}
                    </TableCell>
                    <TableCell>
                      {isLast && canOperate ? (
                        <Stack direction="row" spacing={0.5}>
                          <IconButton
                            size="small"
                            disabled={!canMutateOperate}
                            onClick={() => setChlForm({ ...tx, adjustment_reason: tx.adjustment_reason || '' })}
                          >
                            <EditRounded fontSize="small" />
                          </IconButton>
                          <IconButton
                            size="small"
                            color="error"
                            disabled={!canMutateOperate}
                            onClick={() =>
                              executeWithConflictGuard(
                                () => service.deleteChlorine(tx.id, tx.version),
                                'تم حذف آخر حركة كلور'
                              )
                            }
                          >
                            <DeleteRounded fontSize="small" />
                          </IconButton>
                        </Stack>
                      ) : (
                        '🔒'
                      )}
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </TableContainer>
        <PagedFooter paged={chlPage} testId="paging-chlorine" />
      </>
    );
  }

  // -------------------- VIEW: MULTI-SCOPE REPORTS (Section 14) --------------------
  if (type === 'reports') {
    // only the selector of the active scope applies (a stale asset/category from another scope must not filter)
    const scopedFilters = {
      ...repFilters,
      assetId: repFilters.scope === 'asset' ? repFilters.assetId : '',
      categoryId: repFilters.scope === 'category' ? repFilters.categoryId : '',
      assetIds: repFilters.scope === 'multi_assets' ? repFilters.assetIds : [],
    };
    const reportResult = service.buildReport(data, scopedFilters);
    const cols = getAomsReportColumns(reportResult.type, reportResult.dynamicColumns);
    const reportPage = pageRows('reports', reportResult.rows, JSON.stringify(scopedFilters));
    // identical summary text to the one written into the CSV/Excel/PDF files (REPORT-007/008)
    const usageSummary = formatUsageSummaryText(reportResult.summary);

    return (
      <>
        <Stack direction="row" justifyContent="space-between" alignItems="center" mb={3} flexWrap="wrap" gap={2}>
          <Box>
            <Typography variant="h4" fontWeight={800}>
              التقارير والتصدير متعدد النطاقات
            </Typography>
            <Typography color="text.secondary">
              تقارير أصل واحد، تصنيف كامل، مجموعة أصول مختارة، أو جميع الأصول مع تصدير Excel وCSV وPDF/طباعة
            </Typography>
          </Box>
          <Stack direction="row" spacing={1}>
            <Button variant="outlined" onClick={() => exportAomsCSV(reportResult)}>
              تصدير CSV
            </Button>
            <Button
              variant="outlined"
              color="secondary"
              startIcon={<PictureAsPdfRounded />}
              onClick={() => exportAomsPDF(reportResult, `النطاق: ${REPORT_SCOPE_LABELS[repFilters.scope] || repFilters.scope}`).catch(e => setNotice({ type: 'error', text: e.message }))}
            >
              طباعة / PDF
            </Button>
            <Button
              variant="contained"
              startIcon={<FileDownloadRounded />}
              onClick={() => exportAomsExcel(reportResult, `النطاق: ${REPORT_SCOPE_LABELS[repFilters.scope] || repFilters.scope}`)}
            >
              تصدير Excel
            </Button>
          </Stack>
        </Stack>

        <Paper sx={{ p: 2.5, mb: 3 }}>
          <Grid container spacing={2}>
            <Grid size={{ xs: 12, sm: 4 }}>
              <FormControl fullWidth size="small">
                <InputLabel>نطاق التقرير</InputLabel>
                <Select
                  label="نطاق التقرير"
                  value={repFilters.scope}
                  onChange={e => setRepFilters({ ...repFilters, scope: e.target.value })}
                >
                  {Object.entries(REPORT_SCOPE_LABELS).map(([value, label]) => (
                    <MenuItem key={value} value={value}>{label}</MenuItem>
                  ))}
                </Select>
              </FormControl>
            </Grid>
            {repFilters.scope === 'category' && (
              <Grid size={{ xs: 12, sm: 4 }}>
                <FormControl fullWidth size="small">
                  <InputLabel>اختر التصنيف</InputLabel>
                  <Select
                    label="اختر التصنيف"
                    value={repFilters.categoryId}
                    onChange={e => setRepFilters({ ...repFilters, categoryId: e.target.value })}
                  >
                    {categories.map(c => (
                      <MenuItem key={c.id} value={c.id}>
                        {c.code_prefix} | {c.name}
                      </MenuItem>
                    ))}
                  </Select>
                </FormControl>
              </Grid>
            )}
            {repFilters.scope === 'asset' && (
              <Grid size={{ xs: 12, sm: 4 }}>
                <FormControl fullWidth size="small">
                  <InputLabel>اختر الأصل</InputLabel>
                  <Select
                    label="اختر الأصل"
                    value={repFilters.assetId}
                    onChange={e => setRepFilters({ ...repFilters, assetId: e.target.value })}
                  >
                    {assets.map(a => (
                      <MenuItem key={a.id} value={a.id}>
                        {a.asset_code} | {a.name}
                      </MenuItem>
                    ))}
                  </Select>
                </FormControl>
              </Grid>
            )}
            {repFilters.scope === 'multi_assets' && (
              <Grid size={{ xs: 12, sm: 4 }}>
                <FormControl fullWidth size="small">
                  <InputLabel>اختر الأصول المتعددة</InputLabel>
                  <Select
                    multiple
                    label="اختر الأصول المتعددة"
                    value={repFilters.assetIds}
                    onChange={e => setRepFilters({ ...repFilters, assetIds: e.target.value })}
                  >
                    {assets.map(a => (
                      <MenuItem key={a.id} value={a.id}>
                        {a.asset_code} | {a.name}
                      </MenuItem>
                    ))}
                  </Select>
                </FormControl>
              </Grid>
            )}
            <Grid size={{ xs: 6, sm: 2 }}>
              <TextField
                fullWidth
                size="small"
                type="date"
                label="من تاريخ"
                InputLabelProps={{ shrink: true }}
                value={repFilters.from}
                onChange={e => setRepFilters({ ...repFilters, from: e.target.value })}
              />
            </Grid>
            <Grid size={{ xs: 6, sm: 2 }}>
              <TextField
                fullWidth
                size="small"
                type="date"
                label="إلى تاريخ"
                InputLabelProps={{ shrink: true }}
                value={repFilters.to}
                onChange={e => setRepFilters({ ...repFilters, to: e.target.value })}
              />
            </Grid>
            <Grid size={{ xs: 6, sm: 2 }}>
              <FormControl fullWidth size="small">
                <InputLabel>نوع الحدث</InputLabel>
                <Select
                  label="نوع الحدث"
                  value={repFilters.eventType}
                  onChange={e => setRepFilters({ ...repFilters, eventType: e.target.value })}
                >
                  <MenuItem value="operation">سجلات التشغيل</MenuItem>
                  <MenuItem value="fuel">حركات الوقود</MenuItem>
                  <MenuItem value="chlorine">حركات الكلور</MenuItem>
                  <MenuItem value="all">جميع الأحداث</MenuItem>
                </Select>
              </FormControl>
            </Grid>
            <Grid size={{ xs: 6, sm: 2 }}>
              <FormControl fullWidth size="small">
                <InputLabel>المشغل</InputLabel>
                <Select
                  label="المشغل"
                  value={repFilters.operatorId}
                  onChange={e => setRepFilters({ ...repFilters, operatorId: e.target.value })}
                >
                  <MenuItem value="all">الكل</MenuItem>
                  {operators.map(o => (
                    <MenuItem key={o.id} value={o.id}>
                      {o.name}
                    </MenuItem>
                  ))}
                </Select>
              </FormControl>
            </Grid>
          </Grid>
        </Paper>

        <Alert severity="info" sx={{ mb: 2 }}>
          <b data-testid="report-summary">{usageSummary}</b>
        </Alert>

        <TableContainer component={Paper} sx={{ maxHeight: 600 }}>
          <Table size="small" stickyHeader>
            <TableHead>
              <TableRow>
                {cols.map(c => (
                  <TableCell key={c.key}>{c.label}</TableCell>
                ))}
              </TableRow>
            </TableHead>
            <TableBody>
              {reportPage.rows.map(r => (
                <TableRow key={r.id}>
                  {cols.map(c => (
                    <TableCell key={c.key}>
                      {(() => {
                        // same rule as the CSV/Excel/PDF exports so screen and files match (REPORT-008)
                        const v = r[c.key];
                        if (v === null || v === undefined || v === '') return '—';
                        return c.format ? c.format(v, r) : v;
                      })()}
                    </TableCell>
                  ))}
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </TableContainer>
        <PagedFooter paged={reportPage} testId="paging-report" />
      </>
    );
  }

  // -------------------- VIEW: GLOBAL SEARCH (Section 13.2) --------------------
  if (type === 'search') {
    const results = globalQ.trim() ? service.search(data, globalQ, profile) : [];
    const grouped = results.reduce((acc, item) => {
      (acc[item.entity_type] ??= []).push(item);
      return acc;
    }, {});

    const entityLabels = {
      category: 'التصنيفات',
      asset: 'الأصول والمعدات',
      operator: 'المشغلون',
      operation_log: 'سجلات التشغيل',
      fuel_transaction: 'حركات الوقود',
      chlorine_transaction: 'حركات الكلور',
    };

    return (
      <>
        <Typography variant="h4" fontWeight={800} mb={1}>
          البحث العالمي الشامل
        </Typography>
        <Typography color="text.secondary" mb={3}>
          ابحث في التصنيفات، الأصول، المشغلين، سجلات التشغيل، الوقود، الكلور، والقيم الديناميكية
        </Typography>

        <TextField
          fullWidth
          label="اكتب كلمة البحث (كود أصل، اسم، موقع، ملاحظة، أو قيمة حقل ديناميكي)..."
          value={globalQ}
          onChange={e => setGlobalQ(e.target.value)}
          sx={{ mb: 3 }}
        />

        {Object.entries(grouped).map(([eType, list]) => (
          <Card key={eType} sx={{ mb: 2 }}>
            <CardContent>
              <Typography variant="h6" mb={1.5} color="primary">
                {entityLabels[eType] || eType} ({list.length})
              </Typography>
              <Stack spacing={1}>
                {list.map(item => (
                  <Box
                    key={`${item.entity_type}-${item.entity_id}`}
                    onClick={() =>
                      nav(
                        item.asset_id
                          ? `/${item.tab_key}?asset=${item.asset_id}&highlight=${item.record_id}`
                          : `/${item.tab_key}?highlight=${item.record_id}`
                      )
                    }
                    sx={{
                      p: 1.5,
                      borderRadius: 2,
                      bgcolor: 'action.hover',
                      cursor: 'pointer',
                      display: 'flex',
                      justifyContent: 'space-between',
                    }}
                  >
                    <b>{item.title}</b>
                    <Typography variant="body2" color="text.secondary">
                      {item.subtitle}
                    </Typography>
                  </Box>
                ))}
              </Stack>
            </CardContent>
          </Card>
        ))}
        {globalQ.trim() && results.length === 0 && (
          <Typography textAlign="center" color="text.secondary" p={4}>
            لا توجد نتائج مطابقة في أي من الكيانات الستة.
          </Typography>
        )}
      </>
    );
  }

  // -------------------- VIEW: TIMELINE & ADMIN AUDIT LOG (Section 12) --------------------
  if (type === 'timeline_events') {
    const timelinePage = pageRows('timeline_events', timelineEvents, '');
    const auditPage = pageRows('audit_logs', auditLogs, '');
    return (
      <>
        <Typography variant="h4" fontWeight={800} mb={2}>
          الخط الزمني وسجل التدقيق
        </Typography>
        {isAdmin && (
          <Tabs value={timeTab} onChange={(_, v) => setTimeTab(v)} sx={{ mb: 2 }}>
            <Tab label="الخط الزمني للأصول" />
            <Tab label="سجل التدقيق الإداري (Audit Before / After)" />
          </Tabs>
        )}

        {timeTab === 0 ? (
          <TableContainer component={Paper}>
            <Table size="small">
              <TableHead>
                <TableRow>
                  <TableCell>الوقت</TableCell>
                  <TableCell>الحدث</TableCell>
                  <TableCell>التفاصيل</TableCell>
                </TableRow>
              </TableHead>
              <TableBody>
                {timelinePage.rows.map(evt => (
                  <TableRow
                    key={evt.id}
                    hover
                    sx={{ cursor: evt.asset_id || evt.entity_id ? 'pointer' : 'default' }}
                    onClick={() => {
                      const tab = TIMELINE_ENTITY_TAB[evt.entity_type];
                      if (tab && evt.entity_id) {
                        nav(`/${tab}?${evt.asset_id ? `asset=${evt.asset_id}&` : ''}highlight=${evt.entity_id}`);
                      } else if (evt.asset_id) {
                        nav(`/assets?highlight=${evt.asset_id}`);
                      }
                    }}
                  >
                    <TableCell>{String(evt.created_at || '').slice(0, 19).replace('T', ' ')}</TableCell>
                    <TableCell>
                      <b>{evt.title}</b>
                    </TableCell>
                    <TableCell>{evt.description || '—'}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </TableContainer>
        ) : (
          isAdmin && (
            <TableContainer component={Paper}>
              <Table size="small">
                <TableHead>
                  <TableRow>
                    <TableCell>الوقت</TableCell>
                    <TableCell>العملية</TableCell>
                    <TableCell>الكيان</TableCell>
                    <TableCell>قبل (Before JSON)</TableCell>
                    <TableCell>بعد (After JSON)</TableCell>
                  </TableRow>
                </TableHead>
                <TableBody>
                  {auditPage.rows.map(log => (
                    <TableRow key={log.id}>
                      <TableCell>{String(log.created_at || '').slice(0, 19).replace('T', ' ')}</TableCell>
                      <TableCell>
                        <Chip size="small" label={log.action} />
                      </TableCell>
                      <TableCell>{log.entity_type}</TableCell>
                      <TableCell>
                        <code style={{ fontSize: 11 }}>
                          {log.before_json ? JSON.stringify(log.before_json).slice(0, 120) : '—'}
                        </code>
                      </TableCell>
                      <TableCell>
                        <code style={{ fontSize: 11 }}>
                          {log.after_json ? JSON.stringify(log.after_json).slice(0, 120) : '—'}
                        </code>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </TableContainer>
          )
        )}
        {timeTab === 0 ? (
          <PagedFooter paged={timelinePage} testId="paging-timeline" />
        ) : (
          isAdmin && <PagedFooter paged={auditPage} testId="paging-audit" />
        )}
      </>
    );
  }

  // -------------------- VIEW: SETTINGS & FUEL TYPES --------------------
  if (type === 'settings') {
    return (
      <>
        <Typography variant="h4" fontWeight={800} mb={3}>
          الإعدادات وأنواع الوقود
        </Typography>
        {isAdmin && (
          <Paper sx={{ p: 2.5, mb: 3 }}>
            <Typography variant="h6" mb={2}>
              إدارة أنواع الوقود
            </Typography>
            <Stack direction={{ xs: 'column', sm: 'row' }} spacing={2}>
              <TextField
                size="small"
                label="اسم الوقود (مثل: سولار / بنزين)"
                value={ftForm.name}
                onChange={e => setFtForm({ ...ftForm, name: e.target.value })}
              />
              <TextField
                size="small"
                label="الوحدة (مثل: لتر)"
                value={ftForm.unit}
                onChange={e => setFtForm({ ...ftForm, unit: e.target.value })}
              />
              <FormControl size="small" sx={{ minWidth: 130 }}>
                <InputLabel>الحالة</InputLabel>
                <Select
                  label="الحالة"
                  value={ftForm.status}
                  onChange={e => setFtForm({ ...ftForm, status: e.target.value })}
                >
                  <MenuItem value="active">نشط</MenuItem>
                  <MenuItem value="inactive">غير نشط</MenuItem>
                </Select>
              </FormControl>
              <Button
                variant="contained"
                disabled={!canMutateAdmin}
                onClick={async () => {
                  await executeWithConflictGuard(
                    () => service.saveFuelType(ftForm),
                    'تم حفظ نوع الوقود'
                  );
                  setFtForm({ id: '', name: '', unit: 'لتر', status: 'active' });
                }}
              >
                {ftForm.id ? 'تحديث النوع' : 'إضافة نوع وقود'}
              </Button>
            </Stack>
          </Paper>
        )}

        <TableContainer component={Paper}>
          <Table size="small">
            <TableHead>
              <TableRow>
                <TableCell>اسم الوقود</TableCell>
                <TableCell>الوحدة</TableCell>
                <TableCell>الحالة</TableCell>
                {isAdmin && <TableCell>تعديل</TableCell>}
              </TableRow>
            </TableHead>
            <TableBody>
              {fuelTypes.map(ft => (
                <TableRow key={ft.id}>
                  <TableCell>{ft.name}</TableCell>
                  <TableCell>{ft.unit}</TableCell>
                  <TableCell>
                    <Chip
                      size="small"
                      color={ft.status === 'active' ? 'success' : 'default'}
                      label={ft.status === 'active' ? 'نشط' : 'غير نشط'}
                    />
                  </TableCell>
                  {isAdmin && (
                    <TableCell>
                      <IconButton
                        size="small"
                        disabled={!canMutateAdmin}
                        onClick={() => setFtForm({ ...ft })}
                      >
                        <EditRounded fontSize="small" />
                      </IconButton>
                    </TableCell>
                  )}
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </TableContainer>
      </>
    );
  }

  // -------------------- VIEW: USERS & ROLES (Section 16) --------------------
  if (type === 'users') {
    if (!isAdmin) {
      return <Alert severity="error">هذه الصفحة مخصصة لمدير النظام فقط.</Alert>;
    }
    return (
      <>
        <Typography variant="h4" fontWeight={800} mb={3}>
          المستخدمون والصلاحيات (RBAC)
        </Typography>
        <Paper sx={{ p: 2.5, mb: 3 }}>
          <Typography variant="h6" mb={2}>
            {userForm.id ? 'تعديل صلاحيات وحالة المستخدم' : 'إضافة / دعوة مستخدم'}
          </Typography>
          <Stack direction={{ xs: 'column', sm: 'row' }} spacing={2}>
            <TextField
              size="small"
              label="الاسم الكامل *"
              value={userForm.full_name}
              onChange={e => setUserForm({ ...userForm, full_name: e.target.value })}
            />
            <TextField
              size="small"
              label="البريد الإلكتروني"
              value={userForm.email}
              onChange={e => setUserForm({ ...userForm, email: e.target.value })}
            />
            <FormControl size="small" sx={{ minWidth: 150 }}>
              <InputLabel>الدور</InputLabel>
              <Select
                label="الدور"
                value={userForm.role}
                onChange={e => setUserForm({ ...userForm, role: e.target.value })}
              >
                <MenuItem value={ROLES.ADMIN}>Administrator</MenuItem>
                <MenuItem value={ROLES.OPERATOR}>Operator</MenuItem>
                <MenuItem value={ROLES.VIEWER}>Viewer</MenuItem>
              </Select>
            </FormControl>
            <FormControl size="small" sx={{ minWidth: 130 }}>
              <InputLabel>الحالة</InputLabel>
              <Select
                label="الحالة"
                value={userForm.status}
                onChange={e => setUserForm({ ...userForm, status: e.target.value })}
              >
                <MenuItem value="active">نشط</MenuItem>
                <MenuItem value="inactive">غير نشط</MenuItem>
              </Select>
            </FormControl>
            <Button
              variant="contained"
              disabled={!canMutateAdmin}
              onClick={async () => {
                await executeWithConflictGuard(
                  () => service.saveProfile(userForm),
                  'تم حفظ بيانات وصلاحيات المستخدم'
                );
                setUserForm({
                  id: '',
                  email: '',
                  full_name: '',
                  role: 'operator',
                  status: 'active',
                });
              }}
            >
              حفظ المستخدم
            </Button>
          </Stack>
        </Paper>

        <TableContainer component={Paper}>
          <Table size="small">
            <TableHead>
              <TableRow>
                <TableCell>الاسم الكامل</TableCell>
                <TableCell>البريد</TableCell>
                <TableCell>الدور</TableCell>
                <TableCell>الحالة</TableCell>
                <TableCell>تعديل</TableCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {profiles.map(p => (
                <TableRow key={p.id}>
                  <TableCell>{p.full_name}</TableCell>
                  <TableCell>{p.email || '—'}</TableCell>
                  <TableCell>
                    <Chip size="small" color="primary" label={p.role} />
                  </TableCell>
                  <TableCell>
                    <Chip
                      size="small"
                      color={p.status === 'active' ? 'success' : 'default'}
                      label={p.status === 'active' ? 'نشط' : 'غير نشط'}
                    />
                  </TableCell>
                  <TableCell>
                    <IconButton
                      size="small"
                      disabled={!canMutateAdmin}
                      onClick={() => setUserForm({ ...p })}
                    >
                      <EditRounded fontSize="small" />
                    </IconButton>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </TableContainer>
      </>
    );
  }

  // -------------------- VIEW: BACKUP & ATOMIC RESTORE (Section 19) --------------------
  if (type === 'backup') {
    if (!isAdmin) {
      return <Alert severity="error">النسخ الاحتياطي والاستعادة متاحان لمدير النظام فقط.</Alert>;
    }
    return (
      <>
        <Typography variant="h4" fontWeight={800} mb={1}>
          النسخ الاحتياطي والاستعادة الذرية
        </Typography>
        <Typography color="text.secondary" mb={3}>
          تصدير شامل لجميع الكيانات المعتمدة واستعادة ذرية مسبوقة بمعاينة ونسخة أمان تلقائية
        </Typography>

        <Stack direction="row" spacing={2} mb={3}>
          <Button
            variant="contained"
            startIcon={<BackupRounded />}
            disabled={!canMutateAdmin}
            onClick={async () => {
              try {
                const doc = await service.backup();
                downloadJsonFile(doc, `aoms-v2-backup-${stamp()}.json`);
              } catch (e) {
                setNotice({ type: 'error', text: e.message });
              }
            }}
          >
            تنزيل نسخة احتياطية شاملة (JSON)
          </Button>
          <input
            hidden
            ref={backupFileRef}
            type="file"
            accept="application/json"
            onChange={async e => {
              const f = e.target.files?.[0];
              e.target.value = '';
              if (!f) return;
              try {
                const raw = await f.text();
                const parsed = JSON.parse(raw);
                const preview = service.previewBackup(parsed, f.size || raw.length);
                setBackupDoc(parsed);
                setBackupPreview(preview);
              } catch {
                setBackupPreview({
                  valid: false,
                  errors: ['الملف التالف ليس ملف JSON صالحًا'],
                  counts: {},
                });
              }
            }}
          />
          <Button
            variant="outlined"
            startIcon={<RestoreRounded />}
            disabled={!canMutateAdmin}
            onClick={() => backupFileRef.current?.click()}
          >
            اختيار ملف نسخة احتياطية للمعاينة والاستعادة
          </Button>
        </Stack>

        {backupPreview && (
          <Card>
            <CardContent>
              <Typography variant="h6" mb={1.5}>
                معاينة ملف النسخة الاحتياطية قبل التنفيذ
              </Typography>
              {!backupPreview.valid ? (
                <Alert severity="error">
                  فشل التحقق من الملف:
                  <ul>
                    {backupPreview.errors.map((err, i) => (
                      <li key={i}>{err}</li>
                    ))}
                  </ul>
                </Alert>
              ) : (
                <>
                  <Alert severity="success" sx={{ mb: 2 }}>
                    بنية الملف وجميع المراجع صالحة وجاهزة للاستعادة الذرية.
                  </Alert>
                  <Grid container spacing={1.5} mb={2}>
                    {Object.entries(backupPreview.counts).map(([k, count]) => (
                      <Grid size={{ xs: 6, sm: 3 }} key={k}>
                        <Box sx={{ p: 1.25, borderRadius: 2, bgcolor: 'action.hover' }}>
                          <Typography variant="caption" color="text.secondary">
                            {k}
                          </Typography>
                          <Typography variant="h6" fontWeight={800}>
                            {count}
                          </Typography>
                        </Box>
                      </Grid>
                    ))}
                  </Grid>
                  <Button
                    variant="contained"
                    color="warning"
                    disabled={!canMutateAdmin}
                    onClick={async () => {
                      const currentBackup = await service.backup();
                      downloadJsonFile(currentBackup, `aoms-pre-restore-safety-${stamp()}.json`);
                      await executeWithConflictGuard(
                        () => service.restore(backupDoc),
                        'تم أخذ نسخة أمان واستعادة النسخة الاحتياطية بنجاح'
                      );
                      setBackupPreview(null);
                      setBackupDoc(null);
                    }}
                  >
                    تأكيد وتنفيذ الاستعادة الذرية (ينزّل نسخة أمان أولًا)
                  </Button>
                </>
              )}
            </CardContent>
          </Card>
        )}
      </>
    );
  }

  return null;
}
