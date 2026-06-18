import * as React from 'react';

export interface PaginatedListContext {
    refetchPaginatedList: () => void;
}

// This is split into a separate file from `paginated-list-data-table.tsx` because having them in the same
// file causes module identity issues with dynamic imports in dashboard extensions.
// See: https://github.com/vitejs/vite/issues/3301
export const PaginatedListContext = React.createContext<PaginatedListContext | undefined>(undefined);
