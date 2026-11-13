## Common Tasks

### Formatting Dates, Currencies, and Numbers

```tsx
import {useLocalFormat} from '@vendure/dashboard';
// ...
// Intl API formatting tools
const {
    formatCurrency,
    formatNumber,
    formatDate,
    formatRelativeDate,
    formatLanguageName,
    formatRegionName,
    formatCurrencyName,
    toMajorUnits,
    toMinorUnits,
} = useLocalFormat();

formatCurrency(value: number, currency: string, precision?: number)
formatCurrencyName(currencyCode: string, display: 'full' | 'symbol' | 'name' = 'full')
formatNumber(value: number) // human-readable
formatDate(value: string | Date, options?: Intl.DateTimeFormatOptions)
formatRelativeDate(value: string | Date, options?: Intl.RelativeTimeFormatOptions)
```

### Links

Example link destinations:
- Customer detail | <Link to="/customers/$id" params={{ id }}>text</Link>
- Customer list | <Link to="/customers">text</Link>
- Order detail | <Link to="/orders/$id" params={{ id }}>text</Link>

Important: when linking to detail pages, prefer the `DetailPageButton`. If not in a table column,
add `className='border'`.
