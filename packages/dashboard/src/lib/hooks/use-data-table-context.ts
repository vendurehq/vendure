import { DataTableContext } from '@/vdb/components/data-table/data-table-context.js';
import { useContext } from 'react';

export function useDataTableContext() {
    const context = useContext(DataTableContext);
    if (context === undefined) {
        throw new Error('useDataTableContext must be used within a DataTableProvider');
    }
    return context;
}
