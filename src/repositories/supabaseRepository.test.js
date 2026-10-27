import { describe, expect, it } from 'vitest';
import { SupabaseRepository } from './supabaseRepository';

// Fake PostgREST client that enforces a max_rows cap like Supabase does.
function fakeClient(rows, maxRows) {
  const calls = [];
  const from = table => {
    const st = { table, orders: [], range: null };
    const b = {
      select: () => b,
      eq: () => b,
      order: (col, opts) => (st.orders.push([col, opts?.ascending !== false]), b),
      range: (a, z) => {
        st.range = [a, z];
        calls.push(st);
        const end = Math.min(z, a + maxRows - 1);
        return Promise.resolve({ data: rows.slice(a, end + 1), error: null });
      },
    };
    return b;
  };
  return { client: { from }, calls };
}

describe('REG-006 SupabaseRepository.list paging', () => {
  it('reads every row past the 1000-row max_rows cap with stable ordering', async () => {
    const rows = Array.from({ length: 2501 }, (_, i) => ({ id: String(i).padStart(5, '0') }));
    const { client, calls } = fakeClient(rows, 1000);
    const repo = new SupabaseRepository(client);
    const out = await repo.list('operation_logs', { order: 'created_at', ascending: false });
    expect(out).toHaveLength(2501);
    expect(new Set(out.map(r => r.id)).size).toBe(2501);
    expect(calls.map(c => c.range)).toEqual([[0, 999], [1000, 1999], [2000, 2999]]);
    expect(calls[0].orders).toEqual([['created_at', false], ['id', true]]); // requested order kept, then PK
  });

  it('defaults to creation order + id when no order is requested', async () => {
    const { client, calls } = fakeClient([{ id: 'x' }], 1000);
    await new SupabaseRepository(client).list('categories');
    expect(calls[0].orders).toEqual([['created_at', true], ['id', true]]);
  });

  it('uses composite primary keys as tie-breakers', async () => {
    const { client, calls } = fakeClient([{ asset_id: 'a', field_id: 'f' }], 1000);
    await new SupabaseRepository(client).list('asset_field_values');
    expect(calls[0].orders.map(o => o[0])).toEqual(['created_at', 'asset_id', 'field_id']);
  });
});
