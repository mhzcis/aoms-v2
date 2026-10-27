import { TablePagination } from '@mui/material';

// REG-006: client-side paging for long lists so large tables stay usable.
export const PAGE_SIZES = [10, 25, 50, 100];
export const DEFAULT_PAGE_SIZE = 25;

/**
 * Pure paging helper. `state` is the user's explicit choice ({ page, size, sig }). The chosen page
 * size is kept; the chosen page only while the list's signature (filters + deep-link highlight) is
 * unchanged. Otherwise it opens on the page holding `highlightId` (deep links from search/timeline)
 * or on the first page.
 */
export function paginate(rows, state, { highlightId = '', sig = '' } = {}) {
  const size = state?.size || DEFAULT_PAGE_SIZE;
  const pages = Math.max(1, Math.ceil(rows.length / size));
  let page;
  if (state && state.page != null && state.sig === `${sig}|${highlightId}`) {
    page = state.page;
  } else {
    const idx = highlightId ? rows.findIndex(r => r.id === highlightId) : -1;
    page = idx >= 0 ? Math.floor(idx / size) : 0;
  }
  page = Math.min(Math.max(0, page), pages - 1);
  return { rows: rows.slice(page * size, page * size + size), page, size, count: rows.length };
}

export function PagedFooter({ paged, testId }) {
  if (!paged || paged.count <= PAGE_SIZES[0]) return null;
  return (
    <TablePagination
      component="div"
      data-testid={testId}
      count={paged.count}
      page={paged.page}
      rowsPerPage={paged.size}
      rowsPerPageOptions={PAGE_SIZES}
      onPageChange={(_, page) => paged.onChange({ page })}
      onRowsPerPageChange={e => paged.onChange({ page: 0, size: Number(e.target.value) })}
      labelRowsPerPage="عدد الصفوف:"
      labelDisplayedRows={({ from, to, count }) => `${from}–${to} من ${count}`}
      getItemAriaLabel={t => (t === 'next' ? 'الصفحة التالية' : t === 'previous' ? 'الصفحة السابقة' : t === 'first' ? 'الصفحة الأولى' : 'الصفحة الأخيرة')}
      showFirstButton
      showLastButton
    />
  );
}
