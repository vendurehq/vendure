import { Money } from '@/vdb/components/data-display/money.js';
import { Field, FieldLabel } from '@/vdb/components/ui/field.js';
import { Skeleton } from '@/vdb/components/ui/skeleton.js';
import { api } from '@/vdb/graphql/api.js';
import { graphql } from '@/vdb/graphql/graphql.js';
import { useChannel } from '@/vdb/hooks/use-channel.js';
import { Trans } from '@lingui/react/macro';
import { useQuery } from '@tanstack/react-query';

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
    const { activeChannel } = useChannel();

    const { data: taxRatesData } = useQuery({
        queryKey: ['taxRates'],
        queryFn: () => api.query(taxRatesDocument, { options: { take: 999, skip: 0 } }),
    });

    // The rate is unknown until the tax rates and the Channel have loaded. Until then the rate
    // and the gross price show as skeletons, not as 0% and the net price.
    const taxRate = getTaxRate(
        taxRatesData?.taxRates.items,
        activeChannel?.defaultTaxZone?.id,
        taxCategoryId,
        !!activeChannel,
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
                        <Skeleton className="inline-block h-[0.8lh] w-20 align-middle" aria-hidden="true" />
                    ) : (
                        <Trans>(incl. {taxRate}% tax)</Trans>
                    )}
                </span>
            </FieldLabel>
            <div className="text-sm pt-1.5">
                {grossPrice === undefined ? (
                    <Skeleton className="inline-block h-[1lh] w-20 align-top" aria-hidden="true" />
                ) : (
                    <Money value={grossPrice} currency={currencyCode} />
                )}
            </div>
        </Field>
    );
}

type TaxRateItem = { value: number; zone: { id: string }; category: { id: string } };

/**
 * The rate that applies to the tax category in the Channel's default tax zone, 0 when there
 * is none, or undefined while the tax rates or the Channel are still loading.
 */
export function getTaxRate(
    taxRates: TaxRateItem[] | undefined,
    defaultTaxZoneId: string | undefined,
    taxCategoryId: string | undefined,
    channelLoaded: boolean,
): number | undefined {
    if (!taxRates || !channelLoaded) {
        return undefined;
    }
    if (!defaultTaxZoneId) {
        return 0;
    }
    return (
        taxRates.find(rate => rate.zone.id === defaultTaxZoneId && rate.category.id === taxCategoryId)
            ?.value ?? 0
    );
}
