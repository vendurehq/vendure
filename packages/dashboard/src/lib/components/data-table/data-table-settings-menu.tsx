import { Trans } from '@lingui/react/macro';
import { Table } from '@tanstack/react-table';
import { EllipsisVertical, RefreshCw } from 'lucide-react';
import { Button } from '../ui/button.js';
import {
    DropdownMenu,
    DropdownMenuContent,
    DropdownMenuGroup,
    DropdownMenuItem,
    DropdownMenuLabel,
    DropdownMenuSeparator,
    DropdownMenuTrigger,
} from '../ui/dropdown-menu.js';
import { Tooltip, TooltipContent, TooltipTrigger } from '../ui/tooltip.js';
import { DataTableColumnControls } from './data-table-view-options.js';

interface DataTableSettingsMenuProps<TData> {
    table: Table<TData>;
    /**
     * When true, the column visibility/order section is omitted.
     */
    disableViewOptions?: boolean;
    onRefresh?: () => void;
    isLoading?: boolean;
}

/**
 * The single trigger for the table-level controls: refresh and column
 * settings live behind one Settings2 icon button instead of a row of separate
 * buttons. The trigger keeps the `dt-column-settings-trigger` testid the e2e
 * suite (and any user tests) target.
 */
export function DataTableSettingsMenu<TData>({
    table,
    disableViewOptions,
    onRefresh,
    isLoading,
}: Readonly<DataTableSettingsMenuProps<TData>>) {
    const showColumnControls = !disableViewOptions;

    if (!showColumnControls && onRefresh == null) {
        return null;
    }

    return (
        <DropdownMenu modal={false}>
            <Tooltip>
                <TooltipTrigger
                    render={
                        <DropdownMenuTrigger
                            render={
                                <Button
                                    variant="outline"
                                    size="icon-sm"
                                    data-testid="dt-column-settings-trigger"
                                />
                            }
                        />
                    }
                >
                    <EllipsisVertical />
                </TooltipTrigger>
                <TooltipContent>
                    <Trans>Table settings</Trans>
                </TooltipContent>
            </Tooltip>
            <DropdownMenuContent align="end" className="flex max-h-[70vh] w-max min-w-56 max-w-80 flex-col">
                {onRefresh && (
                    <>
                        <DropdownMenuItem onClick={onRefresh} data-testid="dt-refresh-button">
                            <RefreshCw className={isLoading ? 'animate-rotate' : ''} />
                            <Trans>Refresh</Trans>
                        </DropdownMenuItem>
                        {showColumnControls && <DropdownMenuSeparator />}
                    </>
                )}
                {showColumnControls && (
                    // BaseUI requires GroupLabel to live inside a Menu.Group. The
                    // group must keep the flex-column chain intact so the column
                    // list scrolls while the Reset item stays pinned.
                    <DropdownMenuGroup className="flex min-h-0 flex-1 flex-col">
                        <DropdownMenuLabel>
                            <Trans>Columns</Trans>
                        </DropdownMenuLabel>
                        <DataTableColumnControls table={table} />
                    </DropdownMenuGroup>
                )}
            </DropdownMenuContent>
        </DropdownMenu>
    );
}
