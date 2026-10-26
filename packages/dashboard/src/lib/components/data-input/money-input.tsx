import { useLocalFormat } from '@/vdb/hooks/use-local-format.js';
import { useEffect, useMemo, useRef, useState } from 'react';
import { AffixedInput } from './affixed-input.js';
import { formatMoneyInputValue, getMoneyInputStep } from './money-input-utils.js';

import { DashboardFormComponentProps } from '@/vdb/framework/form-engine/form-engine-types.js';
import { isFieldDisabled } from '@/vdb/framework/form-engine/utils.js';
import { useChannel } from '@/vdb/hooks/use-channel.js';
import { useDisplayLocale } from '@/vdb/hooks/use-display-locale.js';
import { useServerConfig } from '@/vdb/hooks/use-server-config.js';

export interface MoneyInputProps extends DashboardFormComponentProps {
    currency?: string;
}

/**
 * @description
 * A component for displaying a money value. The `currency` can be specified, but otherwise
 * will be taken from the active channel's default currency.
 *
 * @docsCategory form-components
 * @docsPage MoneyInput
 */
export function MoneyInput(props: Readonly<MoneyInputProps>) {
    const { value, onChange, currency, ...rest } = props;
    const { activeChannel } = useChannel();
    const activeCurrency = currency ?? activeChannel?.defaultCurrencyCode;
    const readOnly = isFieldDisabled(props.disabled, props.fieldDef);
    const { bcp47Tag } = useDisplayLocale();
    const { toMinorUnits } = useLocalFormat();
    const precision = useServerConfig()?.moneyStrategyPrecision ?? 2;
    const step = getMoneyInputStep(precision);
    const [displayValue, setDisplayValue] = useState(formatMoneyInputValue(value, precision));
    const isFocused = useRef(false);

    // Update display value when prop value changes externally (but not while the user is typing)
    useEffect(() => {
        if (!isFocused.current) {
            setDisplayValue(formatMoneyInputValue(value, precision));
        }
    }, [value, precision]);

    // Determine if the currency symbol should be a prefix based on locale
    const shouldPrefix = useMemo(() => {
        if (!activeCurrency) {
            return false;
        }
        const parts = new Intl.NumberFormat(bcp47Tag, {
            style: 'currency',
            currency: activeCurrency,
            currencyDisplay: 'symbol',
        }).formatToParts();
        const NaNString = parts.find(p => p.type === 'nan')?.value ?? 'NaN';
        const localised = new Intl.NumberFormat(bcp47Tag, {
            style: 'currency',
            currency: activeCurrency,
            currencyDisplay: 'symbol',
        }).format(undefined as any);
        return localised.indexOf(NaNString) > 0;
    }, [activeCurrency, bcp47Tag]);

    // Get the currency symbol
    const currencySymbol = useMemo(() => {
        if (!activeCurrency) return '';
        const parts = new Intl.NumberFormat(bcp47Tag, {
            style: 'currency',
            currency: activeCurrency,
            currencyDisplay: 'symbol',
        }).formatToParts();
        return parts.find(p => p.type === 'currency')?.value ?? activeCurrency;
    }, [activeCurrency, bcp47Tag]);

    return (
        <AffixedInput
            type="text"
            value={displayValue}
            disabled={readOnly}
            {...rest}
            onFocus={() => {
                isFocused.current = true;
            }}
            onChange={e => {
                const inputValue = e.target.value;
                // Allow empty input
                if (inputValue === '') {
                    setDisplayValue('');
                    onChange(0);
                    return;
                }
                // Only allow numbers and one decimal point
                if (!/^[0-9.]*$/.test(inputValue)) {
                    return;
                }
                setDisplayValue(inputValue);
                const parsed = parseFloat(inputValue);
                if (!isNaN(parsed)) {
                    onChange(toMinorUnits(parsed));
                }
            }}
            onKeyDown={e => {
                if (e.key === 'ArrowUp' || e.key === 'ArrowDown') {
                    e.preventDefault();
                    const currentValue = parseFloat(displayValue) || 0;
                    const newValue = currentValue + (e.key === 'ArrowUp' ? step : -step);
                    if (newValue >= 0) {
                        const newMinorUnits = toMinorUnits(newValue);
                        onChange(newMinorUnits);
                        setDisplayValue(formatMoneyInputValue(newMinorUnits, precision));
                    }
                }
            }}
            onBlur={() => {
                isFocused.current = false;
                const inputValue = displayValue;
                if (inputValue === '') {
                    onChange(0);
                    setDisplayValue(formatMoneyInputValue(0, precision));
                    return;
                }
                const newValue = parseFloat(inputValue);
                if (!isNaN(newValue)) {
                    const newMinorUnits = toMinorUnits(newValue);
                    onChange(newMinorUnits);
                    setDisplayValue(formatMoneyInputValue(newMinorUnits, precision));
                }
            }}
            step={step}
            min="0"
            prefix={shouldPrefix ? currencySymbol : undefined}
            suffix={!shouldPrefix ? currencySymbol : undefined}
        />
    );
}
