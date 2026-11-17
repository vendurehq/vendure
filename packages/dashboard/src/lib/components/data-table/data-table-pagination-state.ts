import type { PaginationState } from '@tanstack/react-table';

export function createPaginationState(page?: number, itemsPerPage?: number): PaginationState {
    return {
        pageIndex: (page ?? 1) - 1,
        pageSize: itemsPerPage ?? 10,
    };
}

export function syncPaginationState(
    current: PaginationState,
    page?: number,
    itemsPerPage?: number,
): PaginationState {
    const next = {
        pageIndex: page == null ? current.pageIndex : page - 1,
        pageSize: itemsPerPage ?? current.pageSize,
    };
    return next.pageIndex === current.pageIndex && next.pageSize === current.pageSize ? current : next;
}
