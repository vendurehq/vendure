import { useDynamicTranslations } from '@/vdb/hooks/use-dynamic-translations.js';
import { useLocalFormat } from '@/vdb/hooks/use-local-format.js';
import { Trans } from '@lingui/react/macro';
import { ColumnFilter } from '@tanstack/react-table';
import { HumanReadableOperator, Operator } from './human-readable-operator.js';
import { ColumnDataType } from './types.js';

/**
 * @description
 * The text of an applied column filter's chip: the field name, the operator and
 * the value, on one line. The chip cuts it to its width.
 *
 * @docsCategory list-views
 * @since 4.0.0
 */
export function DataTableFilterChipLabel({
    filter,
    dataType,
    currencyCode,
}: Readonly<{
    filter: ColumnFilter;
    dataType: ColumnDataType;
    currencyCode: string;
}>) {
    const { getTranslatedFieldName } = useDynamicTranslations();
    const [operator, value] = Object.entries((filter.value ?? {}) as Record<string, unknown>)[0] ?? [];
    return (
        <>
            {getTranslatedFieldName(filter.id)}{' '}
            <span className="text-muted-foreground">
                <HumanReadableOperator operator={operator as Operator} mode="short" />
            </span>{' '}
            <FilterValue value={value} dataType={dataType} currencyCode={currencyCode} />
        </>
    );
}

function FilterValue({
    value,
    dataType,
    currencyCode,
}: Readonly<{
    value: unknown;
    dataType: ColumnDataType;
    currencyCode: string;
}>) {
    const { formatDate, formatCurrency } = useLocalFormat();
    if (typeof value === 'object' && value !== null && !Array.isArray(value)) {
        const record = value as Record<string, unknown>;
        // A range ("between"): start – end.
        if (Object.keys(record).length === 2 && 'start' in record && 'end' in record) {
            return (
                <>
                    <FilterValue value={record.start} dataType={dataType} currencyCode={currencyCode} />
                    <span className="text-muted-foreground"> – </span>
                    <FilterValue value={record.end} dataType={dataType} currencyCode={currencyCode} />
                </>
            );
        }
        return Object.entries(record).map(([key, entry], index) => (
            <span key={key}>
                {index > 0 && ' '}
                <span className="text-muted-foreground">
                    <FilterKeyLabel filterKey={key} />:{' '}
                </span>
                <FilterValue value={entry} dataType={dataType} currencyCode={currencyCode} />
            </span>
        ));
    }
    if (Array.isArray(value)) {
        return value.map((entry, index) => (
            <span key={String(entry)}>
                {index > 0 && ', '}
                <FilterValue value={entry} dataType={dataType} currencyCode={currencyCode} />
            </span>
        ));
    }
    if (typeof value === 'string' && isDateIsoString(value)) {
        return <>{formatDate(value, { dateStyle: 'short' })}</>;
    }
    if (typeof value === 'boolean') {
        return <>{value ? 'true' : 'false'}</>;
    }
    if (typeof value === 'number' && dataType === 'Money') {
        return <>{formatCurrency(value, currencyCode)}</>;
    }
    return <>{String(value ?? '')}</>;
}

function isDateIsoString(value: string) {
    return /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(value);
}

function FilterKeyLabel({ filterKey }: Readonly<{ filterKey: string }>) {
    switch (filterKey) {
        case 'start':
            return <Trans>start</Trans>;
        case 'end':
            return <Trans>end</Trans>;
        default:
            return <>{filterKey}</>;
    }
}
