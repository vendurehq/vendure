import { Trans } from '@lingui/react/macro';
import { Table } from '@tanstack/react-table';
import { ChevronLeft, ChevronRight, ChevronsLeft, ChevronsRight } from 'lucide-react';

import { Button } from '@/vdb/components/ui/button.js';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/vdb/components/ui/select.js';

interface DataTablePaginationProps<TData> {
    table: Table<TData>;
}

export function DataTablePagination<TData>({ table }: DataTablePaginationProps<TData>) {
    const selectedRowCount = Object.keys(table.getState().rowSelection).length;
    return (
        <div className="flex items-center justify-between px-2">
            <div className="flex-1 text-sm text-muted-foreground">
                <Trans>
                    {selectedRowCount} of {table.getFilteredRowModel().rows.length} row(s) selected.
                </Trans>
            </div>
            <div className="flex items-center space-x-6 lg:space-x-8">
                <div className="flex items-center space-x-2">
                    <p className="hidden @xl/table:block text-sm font-medium">
                        <Trans>Rows per page</Trans>
                    </p>
                    <Select
                        value={`${table.getState().pagination.pageSize}`}
                        onValueChange={value => {
                            table.setPageSize(Number(value));
                        }}
                    >
                        <SelectTrigger className="h-8 w-[70px]">
                            <SelectValue placeholder={table.getState().pagination.pageSize} />
                        </SelectTrigger>
                        <SelectContent side="top">
                            {[10, 20, 30, 40, 50].map(pageSize => (
                                <SelectItem key={pageSize} value={`${pageSize}`}>
                                    {pageSize}
                                </SelectItem>
                            ))}
                        </SelectContent>
                    </Select>
                </div>
                <div className=" flex items-center justify-center text-sm font-medium">
                    <span className="hidden @sm/table:block w-[100px] ">
                        <Trans>
                            Page {table.getState().pagination.pageIndex + 1} of {table.getPageCount() || 1}
                        </Trans>
                    </span>
                </div>
                <div className="flex items-center space-x-2">
                    <Button
                        variant="outline"
                        type="button"
                        className="hidden h-8 w-8 p-0 @lg:flex"
                        onClick={() => table.setPageIndex(0)}
                        disabled={!table.getCanPreviousPage()}
                    >
                        <span className="sr-only">
                            <Trans>Go to first page</Trans>
                        </span>
                        <ChevronsLeft />
                    </Button>
                    <Button
                        variant="outline"
                        type="button"
                        className="h-8 w-8 p-0"
                        onClick={() => table.previousPage()}
                        disabled={!table.getCanPreviousPage()}
                    >
                        <span className="sr-only">
                            <Trans>Go to previous page</Trans>
                        </span>
                        <ChevronLeft />
                    </Button>
                    <span className="@md/table:hidden">{table.getState().pagination.pageIndex + 1}</span>
                    <Button
                        variant="outline"
                        type="button"
                        className="h-8 w-8 p-0"
                        onClick={() => table.nextPage()}
                        disabled={!table.getCanNextPage()}
                    >
                        <span className="sr-only">
                            <Trans>Go to next page</Trans>
                        </span>
                        <ChevronRight />
                    </Button>
                    <Button
                        variant="outline"
                        type="button"
                        className="hidden h-8 w-8 p-0 lg:flex"
                        onClick={() => table.setPageIndex(table.getPageCount() - 1)}
                        disabled={!table.getCanNextPage()}
                    >
                        <span className="sr-only">
                            <Trans>Go to last page</Trans>
                        </span>
                        <ChevronsRight />
                    </Button>
                </div>
            </div>
        </div>
    );
}
