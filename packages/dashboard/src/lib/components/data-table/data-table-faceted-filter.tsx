import { Column } from '@tanstack/react-table';
import { ComboboxPrimitive } from '@vendure-io/ui/lib/base-ui';
import { FilterIcon, XIcon } from 'lucide-react';
import * as React from 'react';

import { Button } from '@/vdb/components/ui/button.js';
import { ButtonGroup } from '@/vdb/components/ui/button-group.js';
import {
    Combobox,
    ComboboxContent,
    ComboboxEmpty,
    ComboboxInput,
    ComboboxItem,
    ComboboxList,
    useComboboxAnchor,
} from '@/vdb/components/ui/combobox.js';
import { PopoverTrigger } from '@/vdb/components/ui/popover.js';
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
 * read as one system. The chip body opens the filter; the ✕ segment clears it.
 * By default it must be rendered inside a `<Popover>`. With `triggerType="combobox"`
 * it must be rendered inside a `<Combobox>`, whose search input sits in the popup.
 */
export function FacetedFilterChip({
    icon: Icon,
    title,
    valueLabel,
    onClear,
    triggerType = 'popover',
}: Readonly<{
    icon?: React.ComponentType<{ className?: string }>;
    title?: string;
    valueLabel?: string;
    onClear?: () => void;
    /**
     * The component the chip opens: a `<Popover>` (the default) or a `<Combobox>`.
     */
    triggerType?: 'popover' | 'combobox';
}>) {
    const { t } = useLingui();
    const TriggerIcon = Icon ?? FilterIcon;
    const hasValue = valueLabel != null;
    const Trigger = triggerType === 'combobox' ? ComboboxPrimitive.Trigger : PopoverTrigger;
    // A combobox trigger takes no name from its content.
    const labelId = React.useId();
    const valueId = React.useId();
    const trigger = (
        <Trigger
            render={<Button variant="outline" size="sm" className={cn(!hasValue && 'border-dashed')} />}
            aria-labelledby={
                triggerType === 'combobox' ? (hasValue ? `${labelId} ${valueId}` : labelId) : undefined
            }
        >
            <TriggerIcon />
            <span id={labelId} className="max-w-[200px] truncate">
                {title}
            </span>
            {hasValue && (
                <span id={valueId} className="max-w-[200px] truncate text-muted-foreground">
                    {valueLabel}
                </span>
            )}
        </Trigger>
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
    const anchor = useComboboxAnchor();
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

    const selectedOptions = resolvedOptions.filter(option => selectedValues.has(option.value));
    let valueLabel: string | undefined;
    if (selectedValues.size > 0) {
        valueLabel =
            selectedValues.size > 2 || selectedOptions.length === 0
                ? t`${selectedValues.size} selected`
                : selectedOptions.map(option => option.label).join(', ');
    }

    return (
        <Combobox
            items={resolvedOptions}
            multiple
            value={selectedOptions}
            onValueChange={(next: DataTableFacetedFilterOption[]) => {
                if (isBoolean) {
                    // Radio behaviour: the option just picked replaces the current one,
                    // and picking the current one again clears the filter.
                    const picked = next.find(option => !selectedValues.has(option.value));
                    column?.setFilterValue(picked ? { eq: picked.value } : undefined);
                    return;
                }
                column?.setFilterValue(next.length ? next.map(option => option.value) : undefined);
            }}
            itemToStringLabel={(option: DataTableFacetedFilterOption) => option.label}
            isItemEqualToValue={(a: DataTableFacetedFilterOption, b: DataTableFacetedFilterOption) =>
                a.value === b.value
            }
            defaultOpen={defaultOpen}
            onOpenChange={open => onOpenChange?.(open)}
            loading={isLoading}
        >
            <span ref={anchor} className="inline-flex">
                <FacetedFilterChip
                    icon={icon}
                    title={title}
                    valueLabel={valueLabel}
                    onClear={() => column?.setFilterValue(undefined)}
                    triggerType="combobox"
                />
            </span>
            {/* Opened from the toolbar's Filter menu, the popup has no trigger interaction to
                return focus to when it closes, so it returns focus to the chip. */}
            <ComboboxContent
                anchor={anchor}
                finalFocus={() => anchor.current?.querySelector('button') ?? true}
            >
                <ComboboxInput aria-label={title} placeholder={title} showTrigger={false} />
                <ComboboxEmpty>
                    <Trans>No results found.</Trans>
                </ComboboxEmpty>
                <ComboboxList>
                    {(option: DataTableFacetedFilterOption) => (
                        <ComboboxItem key={String(option.value)} value={option}>
                            {option.icon && <option.icon className="text-muted-foreground" />}
                            <span className="truncate">{option.label}</span>
                            {facets?.get(option.value) && (
                                <span className="ms-auto font-mono text-xs text-muted-foreground">
                                    {facets.get(option.value)}
                                </span>
                            )}
                        </ComboboxItem>
                    )}
                </ComboboxList>
                {selectedValues.size > 0 && (
                    <div className="border-t p-1">
                        <Button
                            variant="ghost"
                            size="sm"
                            className="w-full"
                            onClick={() => column?.setFilterValue(undefined)}
                        >
                            <Trans>Clear filters</Trans>
                        </Button>
                    </div>
                )}
            </ComboboxContent>
        </Combobox>
    );
}
