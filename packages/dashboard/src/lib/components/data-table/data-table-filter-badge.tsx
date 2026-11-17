import { Button } from '@/vdb/components/ui/button.js';
import { ButtonGroup } from '@/vdb/components/ui/button-group.js';
import { useDynamicTranslations } from '@/vdb/hooks/use-dynamic-translations.js';
import { useLocalFormat } from '@/vdb/hooks/use-local-format.js';
import { Trans, useLingui } from '@lingui/react/macro';
import { Filter, XIcon } from 'lucide-react';
import { HumanReadableOperator, Operator } from './human-readable-operator.js';
import { ColumnDataType } from './types.js';

export function DataTableFilterBadge({
    filter,
    onRemove,
    onClick,
    dataType,
    currencyCode,
}: {
    filter: any;
    onRemove: (filter: any) => void;
    onClick?: (filter: any) => void;
    dataType: ColumnDataType;
    currencyCode: string;
}) {
    const { t } = useLingui();
    const { getTranslatedFieldName } = useDynamicTranslations();
    const [operator, value] = Object.entries(filter.value as Record<string, unknown>)[0];
    return (
        <ButtonGroup>
            <Button variant="outline" size="sm" onClick={() => onClick?.(filter)}>
                <Filter />
                <span className="max-w-[200px] truncate" title={filter.id}>
                    {getTranslatedFieldName(filter.id)}
                </span>
                <span className="text-muted-foreground">
                    <HumanReadableOperator operator={operator as Operator} mode="short" />
                </span>
                <span className="max-w-[200px] truncate">
                    <FilterValue value={value} dataType={dataType} currencyCode={currencyCode} />
                </span>
            </Button>
            <Button variant="outline" size="icon-sm" aria-label={t`Remove filter`} onClick={() => onRemove(filter)}>
                <XIcon />
            </Button>
        </ButtonGroup>
    );
}

function FilterValue({
    value,
    dataType,
    currencyCode,
}: {
    value: unknown;
    dataType: ColumnDataType;
    currencyCode: string;
}) {
    const { formatDate, formatCurrency } = useLocalFormat();
    if (typeof value === 'object' && value !== null && !Array.isArray(value)) {
        const entries = Object.entries(value as Record<string, unknown>);
        // Range values (start/end from "between" operator) — render inline with en dash
        if (
            entries.length === 2 &&
            'start' in (value as Record<string, unknown>) &&
            'end' in (value as Record<string, unknown>)
        ) {
            const range = value as Record<string, unknown>;
            return (
                <span className="flex gap-1 items-center">
                    <FilterValue value={range.start} dataType={dataType} currencyCode={currencyCode} />
                    <span className="text-muted-foreground">–</span>
                    <FilterValue value={range.end} dataType={dataType} currencyCode={currencyCode} />
                </span>
            );
        }
        return entries.map(([key, value]) => (
            <span key={key} className="flex gap-1 items-center">
                <span className="text-muted-foreground">
                    <FilterKeyLabel filterKey={key} />:{' '}
                </span>
                <FilterValue value={value} dataType={dataType} currencyCode={currencyCode} />
            </span>
        ));
    }
    if (Array.isArray(value)) {
        return (
            <div className="flex gap-1 items-center">
                [
                {value.map(v => (
                    <FilterValue value={v} dataType={dataType} currencyCode={currencyCode} key={v} />
                ))}
                ]
            </div>
        );
    }
    if (typeof value === 'string' && isDateIsoString(value)) {
        return (
            <div title={formatDate(value, { dateStyle: 'short', timeStyle: 'long' })}>
                {formatDate(value, { dateStyle: 'short' })}
            </div>
        );
    }
    if (typeof value === 'boolean') {
        return <div>{value ? 'true' : 'false'}</div>;
    }
    if (typeof value === 'number' && dataType === 'Money') {
        return <div>{formatCurrency(value, currencyCode)}</div>;
    }
    if (typeof value === 'number') {
        return <div>{value}</div>;
    }
    if (typeof value === 'string') {
        return <div>{value}</div>;
    }
    return <div>{value as string}</div>;
}

function isDateIsoString(value: string) {
    return /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(value);
}

function FilterKeyLabel({ filterKey }: { filterKey: string }) {
    switch (filterKey) {
        case 'start':
            return <Trans>start</Trans>;
        case 'end':
            return <Trans>end</Trans>;
        default:
            return <>{filterKey}</>;
    }
}
