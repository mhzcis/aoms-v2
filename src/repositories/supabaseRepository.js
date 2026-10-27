import { AomsRepository } from './interfaces';
import { ReadCache } from './cache';

export const AOMS_TABLES = [
  'categories',
  'category_fields',
  'category_field_options',
  'assets',
  'asset_field_values',
  'operators',
  'operation_logs',
  'operation_log_values',
  'fuel_types',
  'fuel_transactions',
  'chlorine_transactions',
  'timeline_events',
  'audit_logs',
  'app_settings',
  'profiles',
];

export const LIST_PAGE_SIZE = 1000;

// Stable order for paged reads: creation order (what an un-ordered select returned before, so
// "first category/asset" defaults do not change) and then the primary key as a unique tie-breaker.
const TABLE_KEYS = {
  app_settings: ['key'],
  asset_field_values: ['created_at', 'asset_id', 'field_id'],
  operation_log_values: ['created_at', 'operation_log_id', 'field_id'],
};
const DEFAULT_KEYS = ['created_at', 'id'];

export class SupabaseRepository extends AomsRepository {
  constructor(client) {
    super();
    this.client = client;
    this.cache = new ReadCache();
  }

  async session() {
    return (await this.client.auth.getSession()).data.session;
  }

  async signIn(email, password) {
    const { data, error } = await this.client.auth.signInWithPassword({ email, password });
    if (error) throw error;
    return data;
  }

  async resetPassword(email) {
    const { error } = await this.client.auth.resetPasswordForEmail(email);
    if (error) throw error;
    return true;
  }

  async signOut() {
    const { error } = await this.client.auth.signOut();
    if (error) throw error;
  }

  async profile(id) {
    const { data, error } = await this.client.from('profiles').select('*').eq('id', id).single();
    if (error) throw error;
    this.cache.set('current_profile', data);
    return data;
  }

  async list(table, query = {}) {
    // REG-006: Supabase/PostgREST caps every response at max_rows (1000 by default), so a single
    // select silently truncates large tables. Fetch in fixed-size pages with a stable order
    // (requested order + primary key) until a short page comes back.
    const pageSize = this.pageSize || LIST_PAGE_SIZE;
    const rows = [];
    for (let from = 0; ; from += pageSize) {
      let q = this.client.from(table).select(query.select || '*');
      for (const [k, v] of Object.entries(query.eq || {})) {
        q = q.eq(k, v);
      }
      if (query.order) {
        q = q.order(query.order, { ascending: query.ascending !== false });
      }
      for (const key of TABLE_KEYS[table] || DEFAULT_KEYS) {
        if (key !== query.order) q = q.order(key, { ascending: true });
      }
      const { data, error } = await q.range(from, from + pageSize - 1);
      if (error) {
        if (table === 'audit_logs') return [];
        throw error;
      }
      rows.push(...(data || []));
      if (!data || data.length < pageSize) break;
    }
    this.cache.set(table, rows);
    return rows;
  }

  cached(table) {
    return this.cache.get(table)?.value || [];
  }

  async snapshot() {
    const entries = await Promise.all(
      AOMS_TABLES.map(async t => {
        try {
          const rows = await this.list(t);
          return [t, rows];
        } catch {
          return [t, this.cached(t)];
        }
      })
    );
    return Object.fromEntries(entries);
  }

  async create(table, payload) {
    const { data, error } = await this.client.from(table).insert(payload).select().single();
    if (error) throw error;
    return data;
  }

  async update(table, id, payload, version) {
    let q = this.client.from(table).update(payload).eq('id', id);
    if (version != null) q = q.eq('version', version);
    const { data, error } = await q.select().maybeSingle();
    if (error) throw error;
    if (!data) {
      throw new Error('تعارض إصدار: أعد تحميل البيانات ثم حاول مجددًا');
    }
    return data;
  }

  async upsert(table, payload, onConflict) {
    const { data, error } = await this.client.from(table).upsert(payload, { onConflict }).select().single();
    if (error) throw error;
    return data;
  }

  async invoke(name, args = {}) {
    const { data, error } = await this.client.rpc(name, args);
    if (error) throw error;
    return data;
  }

  subscribe(refresh) {
    return this.client
      .channel('aoms-db')
      .on('postgres_changes', { event: '*', schema: 'public' }, refresh)
      .subscribe();
  }

  unsubscribe(channel) {
    return this.client.removeChannel(channel);
  }
}
