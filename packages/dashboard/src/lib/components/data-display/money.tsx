import { Money as UiMoney } from '@vendure-io/ui/components/molecules/money';

/**
 * @description
 * Renders a monetary value (in integer minor units) using the shared
 * `@vendure-io/ui` `Money` molecule. Locale and minor-unit precision come from
 * the app-wide `FormatBridge` (mirroring `useLocalFormat`); the currency is
 * domain data supplied per call site. When `currency` is omitted the molecule
 * shows a plain number rather than mislabelling the amount as a default
 * currency.
 */
export function Money(props: { value: any; currency?: string; [key: string]: any }) {
    const { value, currency } = props;
    return <UiMoney value={value} currency={currency} />;
}
