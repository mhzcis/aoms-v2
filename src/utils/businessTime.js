export function businessTimeZone(state = {}) {
  const zone = (state.app_settings || []).find(x => x.key === 'business_timezone')?.value || 'Asia/Jerusalem';
  try { new Intl.DateTimeFormat('en', { timeZone: zone }).format(); return zone; }
  catch { return 'Asia/Jerusalem'; }
}

export function businessDateTime(value, timeZone = 'Asia/Jerusalem') {
  if (!value || !Number.isFinite(new Date(value).getTime())) return '—';
  return new Intl.DateTimeFormat('sv-SE', {
    timeZone, year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23',
  }).format(new Date(value));
}

// Date ordering is independent of the host's locale and does not mutate the source array.
export function newestFirst(a, b) {
  return (Date.parse(b.created_at) || 0) - (Date.parse(a.created_at) || 0) || String(b.id || '').localeCompare(String(a.id || ''));
}

export function recentEvents(events = [], { assetIds, from, to, timeZone = 'Asia/Jerusalem', limit = 6 } = {}) {
  return events.filter(e => {
    const day = businessDateTime(e.created_at, timeZone).slice(0, 10);
    return (!assetIds || assetIds.has(e.asset_id)) && (!from || day >= from) && (!to || day <= to);
  }).sort(newestFirst).slice(0, limit);
}
