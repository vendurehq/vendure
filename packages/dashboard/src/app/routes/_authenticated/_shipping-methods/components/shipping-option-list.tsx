import { Trans } from '@lingui/react/macro';

import { MetadataBadges } from './metadata-badges.js';
import { PriceDisplay } from './price-display.js';

interface ShippingOptionListProps {
    options: Array<{
        code?: string | null;
        name?: string | null;
        price: number;
        priceWithTax: number;
        metadata?: any;
    }>;
    currencyCode: string;
}

/**
 * Lists the options of a ShippingMethod whose calculator returns several, cheapest first.
 * Renders nothing for a calculator which returns a single price.
 */
export function ShippingOptionList({ options, currencyCode }: Readonly<ShippingOptionListProps>) {
    if (options.length <= 1) {
        return null;
    }
    return (
        <div className="mt-2 space-y-1">
            <div className="text-xs font-medium text-muted-foreground">
                <Trans>Options</Trans>
            </div>
            <ul className="divide-y rounded-md border">
                {options.map(option => (
                    <li key={option.code} className="flex items-start justify-between gap-4 px-3 py-2">
                        <div>
                            <div>{option.name ?? option.code}</div>
                            {option.name && option.code && (
                                <div className="text-xs text-muted-foreground">{option.code}</div>
                            )}
                            <MetadataBadges metadata={option.metadata} />
                        </div>
                        <PriceDisplay
                            price={option.price}
                            priceWithTax={option.priceWithTax}
                            currencyCode={currencyCode}
                        />
                    </li>
                ))}
            </ul>
        </div>
    );
}
