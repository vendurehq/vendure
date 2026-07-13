import { useLocalFormat } from '@/vdb/hooks/use-local-format.js';

// Original component
function MoneyInternal({ value, currency }: { value: number; currency?: string }) {
    const { formatCurrency, formatNumber, toMajorUnits } = useLocalFormat();
    // Currency is domain data: when it's genuinely unknown (e.g. a generic display
    // component), show the amount as a plain number rather than mislabelling it as
    // some default currency.
    if (!currency) {
        return formatNumber(toMajorUnits(value));
    }
    return formatCurrency(value, currency);
}

// Wrapper that makes it compatible with DataDisplayComponent
export function Money(props: { value: any; [key: string]: any }) {
    const { value, ...rest } = props;
    return MoneyInternal({ value, currency: rest.currency });
}
