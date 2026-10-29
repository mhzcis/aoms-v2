export const RESET_TABLES = Object.freeze(['operation_log_values','operation_logs','fuel_transactions','chlorine_transactions','asset_field_values','timeline_events','assets','category_field_options','category_fields','categories','operators','fuel_types']);
export const RESET_CONFIRMATION = 'مسح شامل';
export async function resetPreview(state) {
  const rows = Object.fromEntries(RESET_TABLES.map(k=>[k,[...(state[k] || (k==='operation_log_values'?state.operation_log_field_values:[]) || [])].sort((a,b)=>JSON.stringify(a).localeCompare(JSON.stringify(b)))]));
  const digest = await crypto.subtle.digest('SHA-256',new TextEncoder().encode(JSON.stringify(rows)));
  return {counts:Object.fromEntries(RESET_TABLES.map(k=>[k,rows[k].length])),fingerprint:Array.from(new Uint8Array(digest),n=>n.toString(16).padStart(2,'0')).join('')};
}
export function assetDefaults(payload,category,existing=null) {
  const result={...payload};
  for(const key of ['fuel_rate','chlorine_consumption','residual_chlorine']) {
    const flag=`has_${key}_override`,value=`${key}_override`;
    const old=existing?.[flag]?existing[value]:category?.[`default_${key}`];
    // Legacy callers are materialized once; the new UI always supplies asset values.
    result[value]=Number(payload[value]!==''&&payload[value]!=null?payload[value]:old??0);result[flag]=true;
    if(!Number.isFinite(result[value])||result[value]<0)throw new Error('القيم الافتراضية للأصل يجب أن تكون أرقامًا غير سالبة');
  }
  return result;
}
export function tankerDistributions(logs,assets,tankerId) {
  return logs.filter(l=>l.tanker_id===tankerId).map(l=>({...l,pump:assets.find(a=>a.id===l.asset_id)})).sort((a,b)=>String(b.operation_date).localeCompare(String(a.operation_date))||String(a.id).localeCompare(String(b.id)));
}
