import { reportTableColumns, reportCell, reportTotals, reportTotalLabelKey } from './reportTableModel';
const NUMERIC = new Set(['previous_reading','current_reading','net_operation_delta','fuel_consumed','water_total','trips_count','distributed_quantity','network_quantity','chlorine_consumed','residual_chlorine','quantity','pump_capacity','effective_fuel_rate','effective_chlorine']);
const DATES = new Set(['log_date','operation_date','transaction_date','event_date']);
export function exportColumn(column, dynamic = []) {
  const field = dynamic.find(f => (f.report_key || `dyn_${f.field_key}`) === column.key);
  const type = (field?.field_type === 'boolean' ? 'text' : field?.field_type) || (NUMERIC.has(column.sourceKey||column.key) ? 'number' : DATES.has(column.key) ? 'date' : 'text');
  return { ...column, type, width: type === 'number' ? 16 : type === 'date' ? 16 : /notes|summary/.test(column.key) ? 36 : 23 };
}

export function prepareReportExport(report, columns, options = {}) {
  if (report.valid === false) throw new Error(report.filterError || 'أكمل فلاتر التقرير');
  if (report.exportError) throw new Error(report.exportError);
  columns=reportTableColumns(report,columns);
  const keys = options.columnKeys ? options.columnKeys.flatMap(key=>columns.filter(c=>c.key===key||c.sourceKey===key).map(c=>c.key)) : columns.map(c => c.key);
  const usedLabels=new Set();
  const cols = [...new Set(keys)].map(k => columns.find(c => c.key === k)).filter(Boolean).map(c => exportColumn(c, report.dynamicColumns)).map(c=>{let label=c.label,n=2;while(usedLabels.has(label))label=`${c.label} (${n++})`;usedLabels.add(label);return {...c,label};});
  if (!cols.length) throw new Error('اختر عمودًا واحدًا على الأقل');
  const direction = options.newestFirst === false ? 1 : -1;
  const date = r => r.event_date || r.log_date || r.operation_date || r.transaction_date || r.created_at || '';
  const rows = [...(report.rows || [])].sort((a,b) => {
    const da=date(a),db=date(b);
    if (!da || !db) return da ? -1 : db ? 1 : String(a.id).localeCompare(String(b.id));
    return direction * (String(da).localeCompare(String(db)) || String(a.created_at || '').localeCompare(String(b.created_at || ''))) || String(a.id).localeCompare(String(b.id));
  });
  const selected = new Set(cols.map(c => c.sourceKey||c.key));
  const metrics = [{ label: 'عدد السجلات المطابقة', value: rows.length, unit: 'سجل' }];
  const totals=reportTotals(report,cols,rows);
  const labels={net_operation_delta:'صافي التشغيل',fuel_consumed:'الوقود المستهلك',chlorine_consumed:'الكلور المستهلك',water_total:'المياه المنتجة',distributed_quantity:'المياه الموزعة',network_quantity:'مياه الشبكة',trips_count:'عدد النقلات'};
  for(const c of cols)if(labels[c.sourceKey||c.key]&&Object.hasOwn(totals,c.key))metrics.push({label:labels[c.sourceKey||c.key],value:totals[c.key],unit:c.unit||''});
  if (selected.has('quantity')) {
    const movements = new Map();
    for (const row of rows.filter(r => r.quantity != null && cols.some(c=>(c.sourceKey||c.key)==='quantity'&&reportCell(r,c)!=null))) {
      const label = `${row.event_type_label || (report.type === 'fuel' ? 'وقود' : 'كلور')} — ${row.transaction_type_label || row.transaction_type || 'حركة'}`;
      const unit = row.unit_snapshot || 'غير محددة'; const key = `${label}|${unit}`;
      const m = movements.get(key) || {label,value:0,unit}; m.value = Math.round((m.value + Number(row.quantity)) * 1e6) / 1e6; movements.set(key,m);
    }
    metrics.push(...movements.values());
  }
  const sortLabel = options.newestFirst === false ? 'الأقدم أولًا' : 'الأحدث أولًا';
  return { ...report, columns:cols, rows:rows.map(row => Object.fromEntries(cols.map(c => [c.key,reportCell(row,c)]))), totals,totalLabelKey:reportTotalLabelKey(cols,totals), metrics, sortLabel,
    generatedAt:options.generatedAt || new Date().toISOString(), orientation:options.orientation || 'auto',
    filtersSummary:report.filtersSummary || 'جميع البيانات', sourceRows:undefined };
}

// PDF widths are points; 12 mm margins leave ~527 / 774 pt on A4.
export function reportOrientation(widths, requested = 'auto') {
  if (requested !== 'auto') return requested;
  return widths.reduce((s,n) => s+n,0) <= 527 ? 'portrait' : 'landscape';
}

export function reportExportError(data, type) {
  const required = ['categories','assets','category_fields','category_field_options','asset_field_values','operators','fuel_types', ...(type === 'fuel' ? ['fuel_transactions'] : type === 'chlorine' ? ['chlorine_transactions'] : ['operation_logs','operation_log_values',...(type === 'events' ? ['fuel_transactions','chlorine_transactions'] : [])])];
  const failed = data.__snapshot?.failedTables || [];
  return required.some(t => failed.includes(t)) ? 'تعذر تحميل بعض بيانات التقرير بالكامل؛ أعد الاتصال وتحديث البيانات قبل التصدير' : '';
}
