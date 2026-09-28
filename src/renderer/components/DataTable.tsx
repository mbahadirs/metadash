import { useEffect, useRef, type ReactNode } from 'react';
import type { XlsxSheet, XlsxType } from './ExcelButton';
import { flexRender, getCoreRowModel, getSortedRowModel, useReactTable, type ColumnDef, type SortingState, type RowSelectionState, type OnChangeFn } from '@tanstack/react-table';
import { useVirtualizer } from '@tanstack/react-virtual';

interface Props<T> {
  data: T[];
  columns: ColumnDef<T, any>[]; // eslint-disable-line @typescript-eslint/no-explicit-any
  sorting: SortingState;
  onSortingChange: OnChangeFn<SortingState>;
  onRowClick?: (row: T) => void;
  selectedId?: string | null;
  getRowId: (row: T) => string;
  rowSelection?: RowSelectionState;
  onRowSelectionChange?: OnChangeFn<RowSelectionState>;
  virtual?: boolean;
  height?: number | string;
  renderExpanded?: (row: T) => ReactNode;
  expandedId?: string | null;
  empty?: ReactNode;
  /** Receives a function that returns the currently visible (filtered + sorted) rows for Excel export. */
  onExportReady?: (getSheet: (name: string) => XlsxSheet) => void;
}

/** Dense TanStack table with sticky header; optional virtualisation for large lists. */
export function DataTable<T>({ data, columns, sorting, onSortingChange, onRowClick, selectedId, getRowId, rowSelection, onRowSelectionChange, virtual, height = '100%', renderExpanded, expandedId, empty, onExportReady }: Props<T>) {
  const table = useReactTable({
    data, columns, state: { sorting, rowSelection: rowSelection ?? {} }, onSortingChange, onRowSelectionChange, getRowId,
    getCoreRowModel: getCoreRowModel(), getSortedRowModel: getSortedRowModel(), enableRowSelection: !!onRowSelectionChange,
  });
  const rows = table.getRowModel().rows;
  useEffect(() => {
    if (!onExportReady) return;
    onExportReady((name) => {
      const cols = table.getVisibleLeafColumns().filter((c) => c.id !== 'select' && c.id !== 'thumb' && c.id !== 'spark');
      const columns = cols.map((c) => {
        const meta = c.columnDef.meta as { align?: string; xlsx?: XlsxType; label?: string } | undefined;
        const header = typeof c.columnDef.header === 'string' ? c.columnDef.header : meta?.label ?? c.id;
        return { key: c.id, label: header, type: meta?.xlsx ?? (meta?.align === 'right' ? 'float' : 'text') as XlsxType };
      });
      const out = table.getRowModel().rows.map((r) => ({ ...(r.original as Record<string, unknown>), ...Object.fromEntries(cols.map((c) => [c.id, r.getValue(c.id)])) }));
      return { name, columns, rows: out };
    });
  }, [onExportReady, table, rows.length, sorting]);
  const parentRef = useRef<HTMLDivElement>(null);
  const virtualizer = useVirtualizer({ count: rows.length, getScrollElement: () => parentRef.current, estimateSize: () => 36, overscan: 12, enabled: !!virtual });
  const items = virtual ? virtualizer.getVirtualItems() : null;
  const padTop = items?.length ? items[0].start : 0;
  const padBottom = items?.length ? virtualizer.getTotalSize() - items[items.length - 1].end : 0;
  const visible = items ? items.map((v) => rows[v.index]) : rows;
  const colCount = table.getAllLeafColumns().length;

  return (
    <div ref={parentRef} className="overflow-auto" style={{ height, maxHeight: height }}>
      <table className="table">
        <thead>
          {table.getHeaderGroups().map((hg) => (
            <tr key={hg.id}>
              {hg.headers.map((h) => {
                const align = (h.column.columnDef.meta as { align?: string } | undefined)?.align;
                const sorted = h.column.getIsSorted();
                return (
                  <th key={h.id} className={align === 'right' ? 'num' : ''} style={{ width: h.getSize() !== 150 ? h.getSize() : undefined }}
                    onClick={h.column.getCanSort() ? h.column.getToggleSortingHandler() : undefined} aria-sort={sorted ? (sorted === 'asc' ? 'ascending' : 'descending') : undefined}>
                    <span className={h.column.getCanSort() ? 'cursor-pointer hover:text-ink-1 inline-flex items-center gap-1' : ''}>
                      {flexRender(h.column.columnDef.header, h.getContext())}
                      {sorted && <span className="text-accent text-[10px]">{sorted === 'asc' ? '▲' : '▼'}</span>}
                    </span>
                  </th>
                );
              })}
            </tr>
          ))}
        </thead>
        <tbody>
          {padTop > 0 && <tr><td style={{ height: padTop, padding: 0, border: 0 }} colSpan={colCount} /></tr>}
          {visible.map((row) => {
            const id = getRowId(row.original);
            return (
              <FragmentRow key={row.id}>
                <tr className={`${onRowClick ? 'clickable' : ''} ${selectedId === id ? 'selected' : ''}`} onClick={() => onRowClick?.(row.original)}>
                  {row.getVisibleCells().map((cell) => {
                    const align = (cell.column.columnDef.meta as { align?: string } | undefined)?.align;
                    return <td key={cell.id} className={align === 'right' ? 'num' : ''}>{flexRender(cell.column.columnDef.cell, cell.getContext())}</td>;
                  })}
                </tr>
                {renderExpanded && expandedId === id && (
                  <tr><td colSpan={colCount} style={{ height: 'auto', whiteSpace: 'normal', padding: 0 }}>{renderExpanded(row.original)}</td></tr>
                )}
              </FragmentRow>
            );
          })}
          {padBottom > 0 && <tr><td style={{ height: padBottom, padding: 0, border: 0 }} colSpan={colCount} /></tr>}
          {rows.length === 0 && <tr><td colSpan={colCount} className="text-center text-ink-2" style={{ height: 80 }}>{empty}</td></tr>}
        </tbody>
      </table>
    </div>
  );
}

function FragmentRow({ children }: { children: ReactNode }) {
  return <>{children}</>;
}
