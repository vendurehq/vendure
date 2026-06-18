import { useLocalFormat } from '@/vdb/hooks/use-local-format.js';

// Original component
function MoneyInternal({ value, currency }: { value: number; currency: string }) {
    const { formatCurrency } = useLocalFormat();
    return formatCurrency(value, currency);
}

// Wrapper that makes it compatible with DataDisplayComponent
export function Money(props: { value: any; [key: string]: any }) {
    const { value, ...rest } = props;
    const currency = rest.currency || 'USD'; // Default currency if none provided
    return MoneyInternal({ value, currency });
}
