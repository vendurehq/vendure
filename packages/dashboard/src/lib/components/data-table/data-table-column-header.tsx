import { useDynamicTranslations } from '@/vdb/hooks/use-dynamic-translations.js';
import { useLingui } from '@lingui/react/macro';
import { ColumnDef, HeaderContext } from '@tanstack/table-core';
import { DataTableColumnHeader as UiDataTableColumnHeader } from '@vendure-io/ui/components/molecules/data-table/data-table-column-header';
import { useMemo } from 'react';
import { ColumnHeaderWrapper } from './column-header-wrapper.js';

export interface DataTableColumnHeaderProps {
    customConfig: Partial<ColumnDef<any>>;
    headerContext: HeaderContext<any, any>;
}

export function DataTableColumnHeader({ headerContext, customConfig }: Readonly<DataTableColumnHeaderProps>) {
    const { column } = headerContext;
    const { t } = useLingui();
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

    return (
        <ColumnHeaderWrapper columnId={column.id}>
            <UiDataTableColumnHeader
                column={column}
                sortLabel={typeof display === 'string' ? t`Sort by ${display}` : undefined}
            >
                {display}
            </UiDataTableColumnHeader>
        </ColumnHeaderWrapper>
    );
}
