import { DataTableFilterDialog } from '@/vdb/components/data-table/data-table-filter-dialog.js';
import { Button } from '@/vdb/components/ui/button.js';
import { Dialog } from '@/vdb/components/ui/dialog.js';
import {
    DropdownMenu,
    DropdownMenuContent,
    DropdownMenuItem,
    DropdownMenuTrigger,
} from '@/vdb/components/ui/dropdown-menu.js';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/vdb/components/ui/tooltip.js';
import { useDynamicTranslations } from '@/vdb/hooks/use-dynamic-translations.js';
import { Trans } from '@lingui/react/macro';
import { Column, ColumnDef } from '@tanstack/react-table';
import { FilterIcon } from 'lucide-react';
import { useState } from 'react';

export interface AddFilterMenuProps {
    columns: Column<any, unknown>[];
}

export function AddFilterMenu({ columns }: Readonly<AddFilterMenuProps>) {
    const [selectedColumn, setSelectedColumn] = useState<ColumnDef<any> | null>(null);
    const [isDialogOpen, setIsDialogOpen] = useState(false);
    const { getTranslatedFieldName } = useDynamicTranslations();
    const filterableColumns = columns.filter(column => column.getCanFilter());

    return (
        <Dialog open={isDialogOpen} onOpenChange={setIsDialogOpen}>
            <DropdownMenu>
                <Tooltip>
                    <TooltipTrigger render={<DropdownMenuTrigger render={<Button variant="outline" size="icon-sm" data-testid="dt-add-filter-trigger" />} />}>
                                <FilterIcon />
                    </TooltipTrigger>
                    <TooltipContent>
                        <Trans>Add filter</Trans>
                    </TooltipContent>
                </Tooltip>
                <DropdownMenuContent align="end" className="w-[200px]">
                    {filterableColumns.map(column => (
                        <DropdownMenuItem
                            key={column.id}
                            onClick={() => {
                                setSelectedColumn(column);
                                setIsDialogOpen(true);
                            }}
                        >
                            {getTranslatedFieldName(column.id)}
                        </DropdownMenuItem>
                    ))}
                </DropdownMenuContent>
            </DropdownMenu>
            {selectedColumn && (
                <DataTableFilterDialog
                    column={selectedColumn as any}
                    onEnter={() => setIsDialogOpen(false)}
                />
            )}
        </Dialog>
    );
}
