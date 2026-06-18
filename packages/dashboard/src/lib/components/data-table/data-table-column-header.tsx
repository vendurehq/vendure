import { Button } from '@/vdb/components/ui/button.js';
import { useDynamicTranslations } from '@/vdb/hooks/use-dynamic-translations.js';
import { ColumnDef, HeaderContext } from '@tanstack/table-core';
import { ArrowDown, ArrowUp, ArrowUpDown } from 'lucide-react';
import { useMemo } from 'react';
import { ColumnHeaderWrapper } from './column-header-wrapper.js';

export interface DataTableColumnHeaderProps {
    customConfig: Partial<ColumnDef<any>>;
    headerContext: HeaderContext<any, any>;
}

export function DataTableColumnHeader({ headerContext, customConfig }: Readonly<DataTableColumnHeaderProps>) {
    const { column } = headerContext;
    const isSortable = column.getCanSort();
    const { getTranslatedFieldName } = useDynamicTranslations();

    const display = useMemo(() => {
        const customHeader = customConfig.header;
        let result = getTranslatedFieldName(column.id);
        if (typeof customHeader === 'function') {
            result = customHeader(headerContext);
        } else if (typeof customHeader === 'string') {
            result = customHeader;
        }
        return result;
    }, [customConfig.header, column.id, getTranslatedFieldName]);

    const columSort = column.getIsSorted();
    const nextSort = columSort === 'asc' ? true : columSort === 'desc' ? undefined : false;

    return (
        <ColumnHeaderWrapper columnId={column.id}>
            <div className="flex items-center">
                {isSortable && (
                    <Button size="icon-sm" variant="ghost" onClick={() => column.toggleSorting(nextSort)}>
                        {columSort === 'desc' ? (
                            <ArrowUp />
                        ) : columSort === 'asc' ? (
                            <ArrowDown />
                        ) : (
                            <ArrowUpDown className="opacity-50" />
                        )}
                    </Button>
                )}
                <div>{display}</div>
            </div>
        </ColumnHeaderWrapper>
    );
}
