// FIELD-003 on the real AomsService (the Supabase code path): a select field without an active
// option is rejected before anything is written. The DB enforces the same rule (migration 004,
// see supabase/tests/run-db-acceptance.mjs FIELD-003); the app saves field + options atomically.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { AomsService } from './aomsService';

const fakeRepo = () => ({
  create: vi.fn(async (t, row) => ({ id: `${t}-1`, ...row })),
  update: vi.fn(),
  invoke: vi.fn(async (_n, a) => ({ id: 'f-1', ...a.p_field })),
});
const field = { category_id: 'c1', scope: 'asset', field_key: 'kind', label: 'النوع', field_type: 'select' };

describe('FIELD-003 select field needs an active option (AomsService)', () => {
  beforeEach(() => vi.stubGlobal('navigator', { onLine: true }));
  afterEach(() => vi.unstubAllGlobals());

  it('rejects no options / only inactive or blank options and writes nothing', async () => {
    for (const opts of [[], [{ label: 'قديم', is_active: false }], [{ label: '  ' }]]) {
      const repo = fakeRepo();
      await expect(new AomsService(repo).saveCategoryField(field, opts, [])).rejects.toThrow('خيارًا نشطًا');
      expect(repo.create).not.toHaveBeenCalled();
      expect(repo.invoke).not.toHaveBeenCalled();
    }
  });

  it('accepts a select field with one active option and saves field + options in ONE atomic RPC', async () => {
    const repo = fakeRepo();
    await new AomsService(repo).saveCategoryField(field, [{ label: 'هوائي' }, { label: 'معطل', is_active: false }, { label: ' ' }], []);
    expect(repo.create).not.toHaveBeenCalled();
    expect(repo.invoke).toHaveBeenCalledTimes(1);
    const [name, args] = repo.invoke.mock.calls[0];
    expect(name).toBe('save_category_field');
    expect(args.p_field).toMatchObject({ field_key: 'kind', field_type: 'select', is_active: true });
    expect(args.p_options).toEqual([
      expect.objectContaining({ label: 'هوائي', is_active: true }),
      expect.objectContaining({ label: 'معطل', is_active: false }),
    ]);
  });
});
