import { describe, expect, it } from 'vitest';
import { paginate } from './Paged';

const rows = Array.from({ length: 3000 }, (_, i) => ({ id: `r${i}` }));

describe('REG-006 paginate', () => {
  it('shows 25 rows per page by default and reports the full count', () => {
    const p = paginate(rows, undefined);
    expect(p.rows).toHaveLength(25);
    expect(p.rows[0].id).toBe('r0');
    expect(p.count).toBe(3000);
  });
  it('opens on the page holding the highlighted row', () => {
    const p = paginate(rows, undefined, { highlightId: 'r2010' });
    expect(p.page).toBe(80);
    expect(p.rows.map(r => r.id)).toContain('r2010');
  });
  it('keeps the explicit page for the same filter and resets when the filter changes', () => {
    expect(paginate(rows, { page: 5, size: 100, sig: 'x|' }, { sig: 'x' }).rows[0].id).toBe('r500');
    const changed = paginate(rows, { page: 5, size: 100, sig: 'x|' }, { sig: 'y' });
    expect(changed.page).toBe(0);
    expect(changed.size).toBe(100); // the chosen page size survives a filter change
  });
  it('a new deep-link highlight overrides the page the user was on', () => {
    const p = paginate(rows, { page: 0, size: 100, sig: 'a|' }, { sig: 'a', highlightId: 'r2010' });
    expect(p.page).toBe(20);
    expect(p.rows.map(r => r.id)).toContain('r2010');
  });
  it('clamps an out-of-range page after the list shrinks', () => {
    const p = paginate(rows.slice(0, 30), { page: 9, size: 25, sig: '|' });
    expect(p.page).toBe(1);
    expect(p.rows).toHaveLength(5);
  });
});
