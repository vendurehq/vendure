import { CurrencyCode } from '@/vdb/constants.js';
import { useLocalFormat } from '@/vdb/hooks/use-local-format.js';
import { useLingui } from '@lingui/react/macro';
import { MultiSelect } from './multi-select.js';

export interface CurrencySelectorProps<T extends boolean> {
    value: T extends true ? string[] : string;
    onChange: (value: T extends true ? string[] : string) => void;
    multiple?: T;
    availableCurrencyCodes?: string[];
}

export function CurrencySelector<T extends boolean>(props: CurrencySelectorProps<T>) {
    const { formatCurrencyName } = useLocalFormat();
    const { value, onChange, multiple, availableCurrencyCodes } = props;
    const { t } = useLingui();

    const items = (availableCurrencyCodes ?? Object.values(CurrencyCode)).map(currencyCode => ({
        value: currencyCode,
        label: formatCurrencyName(currencyCode),
    }));

    return (
        <MultiSelect
            value={value}
            onChange={onChange}
            multiple={multiple}
            items={items}
            placeholder={t`Select a currency`}
            searchPlaceholder={t`Search currencies...`}
        />
    );
}
