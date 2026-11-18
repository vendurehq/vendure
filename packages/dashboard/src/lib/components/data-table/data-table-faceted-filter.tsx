import { Column } from '@tanstack/react-table';
import { FilterIcon, XIcon } from 'lucide-react';
import * as React from 'react';

import { Button } from '@/vdb/components/ui/button.js';
import { ButtonGroup } from '@/vdb/components/ui/button-group.js';
import { Checkbox } from '@/vdb/components/ui/checkbox.js';
import {
    Command,
    CommandEmpty,
    CommandGroup,
    CommandInput,
    CommandItem,
    CommandList,
    CommandSeparator,
} from '@/vdb/components/ui/command.js';
import { Popover, PopoverContent, PopoverTrigger } from '@/vdb/components/ui/popover.js';
import { cn } from '@/vdb/lib/utils.js';
import { Trans, useLingui } from '@lingui/react/macro';

export interface DataTableFacetedFilterOption {
    label: string;
    value: any;
    icon?: React.ComponentType<{ className?: string }>;
}

export interface DataTableFacetedFilterProps<TData, TValue> {
    column?: Column<TData, TValue>;
    title?: string;
    icon?: React.ComponentType<{ className?: string }>;
    options?: DataTableFacetedFilterOption[];
    optionsFn?: () => Promise<DataTableFacetedFilterOption[]>;
    /**
     * When true, the filter's popover opens as soon as the chip mounts — used
     * when the filter is launched from the toolbar's unified "Filter" menu.
     */
    defaultOpen?: boolean;
    onOpenChange?: (open: boolean) => void;
}

/**
 * The chip that represents a faceted filter in the toolbar's active-filter row.
 * Styled to match {@link DataTableFilterBadge} so faceted and column filters
 * read as one system. Must be rendered inside a `<Popover>` — the chip body is
 * the popover trigger; the ✕ segment clears the filter.
 */
export function FacetedFilterChip({
    icon: Icon,
    title,
    valueLabel,
    onClear,
}: Readonly<{
    icon?: React.ComponentType<{ className?: string }>;
    title?: string;
    valueLabel?: string;
    onClear?: () => void;
}>) {
    const { t } = useLingui();
    const TriggerIcon = Icon ?? FilterIcon;
    const hasValue = valueLabel != null;
    const trigger = (
        <PopoverTrigger
            render={<Button variant="outline" size="sm" className={cn(!hasValue && 'border-dashed')} />}
        >
            <TriggerIcon />
            <span className="max-w-[200px] truncate">{title}</span>
            {hasValue && <span className="max-w-[200px] truncate text-muted-foreground">{valueLabel}</span>}
        </PopoverTrigger>
    );
    if (!hasValue || !onClear) {
        return trigger;
    }
    return (
        <ButtonGroup>
            {trigger}
            <Button variant="outline" size="icon-sm" aria-label={t`Remove filter`} onClick={onClear}>
                <XIcon />
            </Button>
        </ButtonGroup>
    );
}

export function DataTableFacetedFilter<TData, TValue>({
    column,
    title,
    icon,
    options,
    optionsFn,
    defaultOpen,
    onOpenChange,
}: DataTableFacetedFilterProps<TData, TValue>) {
    const { t } = useLingui();
    const facets = column?.getFacetedUniqueValues();
    const filterValue = column?.getFilterValue();

    const selectedValues = filterValue
        ? new Set(Object.values(filterValue as Record<string, string>))
        : new Set();

    const [resolvedOptions, setResolvedOptions] = React.useState<DataTableFacetedFilterOption[]>(
        options || [],
    );
    const [isLoading, setIsLoading] = React.useState(false);

    React.useEffect(() => {
        if (optionsFn) {
            setIsLoading(true);
            optionsFn()
                .then(result => {
                    setResolvedOptions(result);
                })
                .catch(error => {
                    console.error('Failed to load filter options:', error);
                })
                .finally(() => {
                    setIsLoading(false);
                });
        } else if (options) {
            setResolvedOptions(options);
        }
    }, [optionsFn]);
    const isBoolean = (column?.columnDef?.meta as any)?.fieldInfo.type === 'Boolean';

    const selectedLabels = resolvedOptions
        .filter(option => selectedValues.has(option.value))
        .map(option => option.label);
    let valueLabel: string | undefined;
    if (selectedValues.size > 0) {
        valueLabel =
            selectedValues.size > 2 || selectedLabels.length === 0
                ? t`${selectedValues.size} selected`
                : selectedLabels.join(', ');
    }

    return (
        <Popover defaultOpen={defaultOpen} onOpenChange={onOpenChange}>
            <FacetedFilterChip
                icon={icon}
                title={title}
                valueLabel={valueLabel}
                onClear={() => column?.setFilterValue(undefined)}
            />
            <PopoverContent className="w-auto min-w-50 max-w-75 p-0">
                <Command>
                    {resolvedOptions.length > 2 ? <CommandInput placeholder={title} /> : null}
                    <CommandList>
                        <CommandEmpty>No results found.</CommandEmpty>
                        <CommandGroup>
                            {resolvedOptions.map(option => {
                                const isSelected = selectedValues.has(option.value);
                                return (
                                    <CommandItem
                                        key={option.value}
                                        onSelect={() => {
                                            if (isBoolean) {
                                                // Radio button behavior: single selection only
                                                if (isSelected) {
                                                    // Deselect if clicking the same option
                                                    column?.setFilterValue(undefined);
                                                } else {
                                                    // Select only this option
                                                    column?.setFilterValue({ eq: option.value });
                                                }
                                            } else {
                                                // Checkbox behavior: multi-selection
                                                if (isSelected) {
                                                    selectedValues.delete(option.value);
                                                } else {
                                                    selectedValues.add(option.value);
                                                }
                                                const filterValues = Array.from(selectedValues);
                                                column?.setFilterValue(
                                                    filterValues.length ? filterValues : undefined,
                                                );
                                            }
                                        }}
                                    >
                                        {isBoolean ? (
                                            <div
                                                className={cn(
                                                    'mr-2 flex h-4 w-4 items-center justify-center rounded-full border border-primary',
                                                    isSelected ? 'bg-primary text-primary-foreground' : '',
                                                )}
                                            >
                                                {isSelected && (
                                                    <div className="h-2 w-2 rounded-full bg-primary-foreground" />
                                                )}
                                            </div>
                                        ) : (
                                            <Checkbox
                                                checked={isSelected}
                                                className="mr-2 pointer-events-none"
                                                tabIndex={-1}
                                            />
                                        )}
                                        {option.icon && (
                                            <option.icon className="mr-2 h-4 w-4 text-muted-foreground" />
                                        )}
                                        <span>{option.label}</span>
                                        {facets?.get(option.value) && (
                                            <span className="ml-auto flex h-4 w-4 items-center justify-center font-mono text-xs">
                                                {facets.get(option.value)}
                                            </span>
                                        )}
                                    </CommandItem>
                                );
                            })}
                        </CommandGroup>
                        {selectedValues.size > 0 && (
                            <>
                                <CommandSeparator />
                                <CommandGroup>
                                    <CommandItem
                                        onSelect={() => column?.setFilterValue(undefined)}
                                        className="justify-center text-center"
                                    >
                                        <Trans>Clear filters</Trans>
                                    </CommandItem>
                                </CommandGroup>
                            </>
                        )}
                    </CommandList>
                </Command>
            </PopoverContent>
        </Popover>
    );
}
