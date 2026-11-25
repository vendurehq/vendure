import { Money } from '@/vdb/components/data-display/money.js';
import { Field, FieldLabel } from '@/vdb/components/ui/field.js';
import { Skeleton } from '@/vdb/components/ui/skeleton.js';
import { api } from '@/vdb/graphql/api.js';
import { graphql } from '@/vdb/graphql/graphql.js';
import { useChannel } from '@/vdb/hooks/use-channel.js';
import { Trans, useLingui } from '@lingui/react/macro';
import { useQuery } from '@tanstack/react-query';

import { getTaxRate } from '../utils/tax-rate.js';

const taxRatesDocument = graphql(`
    query TaxRates($options: TaxRateListOptions) {
        taxRates(options: $options) {
            items {
                id
                value
                zone {
                    id
                }
                category {
                    id
                }
            }
        }
    }
`);

export const TAX_RATES_QUERY_KEY = ['taxRates'];

interface VariantPriceDetailProps {
    priceIncludesTax: boolean;
    price: number | undefined;
    currencyCode: string;
    taxCategoryId: string | undefined;
}

export function VariantPriceDetail({
    priceIncludesTax,
    price,
    currencyCode,
    taxCategoryId,
}: VariantPriceDetailProps) {
    const { t } = useLingui();
    const { activeChannel } = useChannel();

    const { data: taxRatesData, isError } = useQuery({
        queryKey: TAX_RATES_QUERY_KEY,
        queryFn: () => api.query(taxRatesDocument, { options: { take: 999, skip: 0 } }),
    });

    // The rate is unknown until the tax rates and the Channel have loaded. Until then the rate
    // and the gross price show as skeletons, not as 0% and the net price. If the tax rates
    // cannot load, the rate falls back to 0%, as the stock labels fall back to their plain text.
    const taxRate = getTaxRate(
        taxRatesData?.taxRates.items ?? (isError ? [] : undefined),
        activeChannel,
        taxCategoryId,
    );
    const grossPrice =
        taxRate === undefined
            ? undefined
            : priceIncludesTax
              ? (price ?? 0)
              : Math.round((price ?? 0) * ((100 + taxRate) / 100));

    return (
        <Field>
            <FieldLabel>
                <Trans>Gross price</Trans>{' '}
                <span className="text-muted-foreground">
                    {taxRate === undefined ? (
                        <Skeleton
                            data-slot="tax-rate-skeleton"
                            className="inline-block h-[0.8lh] w-20 align-middle"
                            aria-hidden="true"
                        />
                    ) : (
                        <Trans>(incl. {taxRate}% tax)</Trans>
                    )}
                </span>
            </FieldLabel>
            <div className="text-sm pt-1.5">
                {grossPrice === undefined ? (
                    <>
                        <Skeleton
                            data-slot="gross-price-skeleton"
                            className="inline-block h-[1lh] w-20 align-top"
                            aria-hidden="true"
                        />
                        <span className="sr-only">{t`Loading…`}</span>
                    </>
                ) : (
                    <Money value={grossPrice} currency={currencyCode} />
                )}
            </div>
        </Field>
    );
}
