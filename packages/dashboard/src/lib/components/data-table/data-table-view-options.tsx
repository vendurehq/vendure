import { closestCenter, DndContext } from '@dnd-kit/core';
import { restrictToVerticalAxis } from '@dnd-kit/modifiers';
import { SortableContext, useSortable, verticalListSortingStrategy } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { Table } from '@tanstack/react-table';
import { Eye, EyeOff, GripVertical, Settings2 } from 'lucide-react';

import { Button } from '@/vdb/components/ui/button.js';
import {
    DropdownMenu,
    DropdownMenuCheckboxItem,
    DropdownMenuContent,
    DropdownMenuItem,
    DropdownMenuSeparator,
    DropdownMenuTrigger,
} from '@/vdb/components/ui/dropdown-menu.js';
// Note: we intentionally don't use ScrollArea here because its viewport
// doesn't properly resolve height:100% from a flex-computed parent height,
// preventing scrolling. A plain overflow-y-auto div works correctly in a flex layout.
import { Tooltip, TooltipContent, TooltipTrigger } from '@/vdb/components/ui/tooltip.js';
import { useDynamicTranslations } from '@/vdb/hooks/use-dynamic-translations.js';
import { usePage } from '@/vdb/hooks/use-page.js';
import { useUserSettings } from '@/vdb/hooks/use-user-settings.js';
import { Trans } from '@lingui/react/macro';

import { pinnedLeadingColumns } from './data-table-utils.js';

interface DataTableViewOptionsProps<TData> {
    table: Table<TData>;
}

function SortableItem({
    id,
    children,
    disableSort,
}: {
    id: string;
    children: React.ReactNode;
    disableSort?: boolean;
}) {
    const { attributes, listeners, setNodeRef, transform, transition } = useSortable({ id });

    const style = {
        transform: CSS.Transform.toString(transform),
        transition,
    };

    return (
        <div ref={setNodeRef} style={style} className="flex items-center gap-.5">
            {!disableSort ? (
                <div {...attributes} {...listeners} className="cursor-grab">
                    <GripVertical className="h-4 w-4 text-muted-foreground" />
                </div>
            ) : (
                <div className="w-4" />
            )}
            {children}
        </div>
    );
}

/**
 * The body of the column settings menu — the sortable visibility-checkbox list
 * plus the Reset item — without any trigger or DropdownMenuContent wrapper, so
 * it can be embedded in the merged table-settings menu as well as the
 * standalone {@link DataTableViewOptions} dropdown. Expects a flex-column
 * parent that constrains its height (the list scrolls, Reset stays pinned).
 */
export function DataTableColumnControls<TData>({ table }: DataTableViewOptionsProps<TData>) {
    const { setTableSettings } = useUserSettings();
    const { getTranslatedFieldName } = useDynamicTranslations();
    const page = usePage();
    const columns = table
        .getAllColumns()
        .filter(column => typeof column.accessorFn !== 'undefined' && column.getCanHide());

    const handleDragEnd = (event: any) => {
        const { active, over } = event;
        if (active.id !== over.id) {
            const activeIndex = columns.findIndex(col => col.id === active.id);
            const overIndex = columns.findIndex(col => col.id === over.id);
            // update the column order in the `columns` array
            const newColumns = [...columns];
            newColumns.splice(overIndex, 0, newColumns.splice(activeIndex, 1)[0]);
            if (page?.pageId) {
                setTableSettings(
                    page.pageId,
                    'columnOrder',
                    newColumns.map(col => col.id),
                );
            }
        }
    };

    const handleReset = () => {
        if (page?.pageId) {
            setTableSettings(page.pageId, 'columnOrder', undefined);
            setTableSettings(page.pageId, 'columnVisibility', undefined);
        }
    };

    return (
        <>
            <div className="min-h-0 flex-1 overflow-y-auto">
                <DndContext
                    collisionDetection={closestCenter}
                    onDragEnd={handleDragEnd}
                    modifiers={[restrictToVerticalAxis]}
                >
                    <SortableContext
                        items={columns.map(col => col.id)}
                        strategy={verticalListSortingStrategy}
                    >
                        {columns.map(column => (
                            <SortableItem
                                key={column.id}
                                id={column.id}
                                disableSort={pinnedLeadingColumns.includes(column.id)}
                            >
                                {/* The default trailing checkmark indicator is hidden in
                                    favour of right-aligned eye icons; the element keeps its
                                    menuitemcheckbox role and aria-checked state. */}
                                <DropdownMenuCheckboxItem
                                    className="capitalize flex-1 pr-2 [&_[data-slot=dropdown-menu-checkbox-item-indicator]]:hidden"
                                    checked={column.getIsVisible()}
                                    onCheckedChange={value => column.toggleVisibility(value)}
                                    closeOnClick={false}
                                >
                                    {getTranslatedFieldName(column.id)}
                                    <span className="ml-auto text-muted-foreground">
                                        {column.getIsVisible() ? <Eye /> : <EyeOff className="opacity-50" />}
                                    </span>
                                </DropdownMenuCheckboxItem>
                            </SortableItem>
                        ))}
                    </SortableContext>
                </DndContext>
            </div>
            <DropdownMenuSeparator />
            <DropdownMenuItem onClick={handleReset}>
                <Trans>Reset</Trans>
            </DropdownMenuItem>
        </>
    );
}

export function DataTableViewOptions<TData>({ table }: DataTableViewOptionsProps<TData>) {
    return (
        <div className="flex items-center gap-2">
            <DropdownMenu modal={false}>
                <Tooltip>
                    <TooltipTrigger
                        render={
                            <DropdownMenuTrigger
                                render={
                                    <Button
                                        variant="outline"
                                        size="icon-sm"
                                        className="ml-auto hidden lg:flex"
                                        data-testid="dt-column-settings-trigger"
                                    />
                                }
                            />
                        }
                    >
                        <Settings2 />
                    </TooltipTrigger>
                    <TooltipContent>
                        <Trans>Column settings</Trans>
                    </TooltipContent>
                </Tooltip>
                <DropdownMenuContent align="end" className="flex max-h-[70vh] w-max max-w-80 flex-col">
                    <DataTableColumnControls table={table} />
                </DropdownMenuContent>
            </DropdownMenu>
        </div>
    );
}
