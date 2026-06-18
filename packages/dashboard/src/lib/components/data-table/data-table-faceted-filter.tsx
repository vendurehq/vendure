import { Column } from '@tanstack/react-table';
import { FilterIcon } from 'lucide-react';
import * as React from 'react';

import { Badge } from '@/vdb/components/ui/badge.js';
import { Button } from '@/vdb/components/ui/button.js';
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
import { Separator } from '@/vdb/components/ui/separator.js';
import { cn } from '@/vdb/lib/utils.js';
import { Trans } from '@lingui/react/macro';

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
}

export function DataTableFacetedFilter<TData, TValue>({
    column,
    title,
    icon,
    options,
    optionsFn,
}: DataTableFacetedFilterProps<TData, TValue>) {
    const facets = column?.getFacetedUniqueValues();
    const filterValue = column?.getFilterValue();

    const selectedValues = filterValue
        ? new Set(Object.values(filterValue as Record<string, string>))
        : new Set();

    const [resolvedOptions, setResolvedOptions] = React.useState<DataTableFacetedFilterOption[]>(
        options || [],
    );
    const [isLoading, setIsLoading] = React.useState(false);
    const Icon = icon;

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

    return (
        <Popover>
            <PopoverTrigger render={<Button variant="outline" size="sm" className="h-8" />}>
                    {Icon && <Icon />}
                    {!Icon && <FilterIcon />}
                    {title}
                    {selectedValues?.size > 0 && (
                        <>
                            <Separator orientation="vertical" className="mx-2" />
                            <Badge variant="secondary" className="rounded-sm px-1 font-normal lg:hidden">
                                {selectedValues.size}
                            </Badge>
                            <div className="hidden space-x-1 lg:flex">
                                {selectedValues.size > 2 ? (
                                    <Badge variant="secondary" className="rounded-sm px-1 font-normal">
                                        {selectedValues.size} selected
                                    </Badge>
                                ) : (
                                    resolvedOptions
                                        .filter(option => selectedValues.has(option.value))
                                        .map(option => (
                                            <Badge
                                                variant="secondary"
                                                key={option.value}
                                                className="rounded-sm px-1 font-normal"
                                            >
                                                {option.label}
                                            </Badge>
                                        ))
                                )}
                            </div>
                        </>
                    )}
            </PopoverTrigger>
            <PopoverContent className="w-auto min-w-50 max-w-75 p-0" align="start">
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
                                                    isSelected
                                                        ? 'bg-primary text-primary-foreground'
                                                        : '',
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
