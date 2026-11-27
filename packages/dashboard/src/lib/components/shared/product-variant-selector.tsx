import {
    Combobox,
    ComboboxContent,
    ComboboxEmpty,
    ComboboxInput,
    ComboboxItem,
    ComboboxList,
} from '@/vdb/components/ui/combobox.js';
import { api } from '@/vdb/graphql/api.js';
import { AssetFragment, assetFragment } from '@/vdb/graphql/fragments.js';
import { graphql } from '@/vdb/graphql/graphql.js';
import { useQuery } from '@tanstack/react-query';
import { useDebounce } from '@uidotdev/usehooks';
import { Trans, useLingui } from '@lingui/react/macro';
import { ComboboxPrimitive } from '@vendure-io/ui/lib/base-ui';
import { Plus } from 'lucide-react';
import { useId, useRef, useState } from 'react';
import { Button } from '../ui/button.js';
import { VendureImage } from './vendure-image.js';

const productVariantListDocument = graphql(
    `
        query ProductVariantList($options: ProductVariantListOptions) {
            productVariants(options: $options) {
                items {
                    id
                    name
                    sku
                    featuredAsset {
                        ...Asset
                    }
                    price
                    priceWithTax
                    product {
                        featuredAsset {
                            ...Asset
                        }
                    }
                }
                totalItems
            }
        }
    `,
    [assetFragment],
);

export interface ProductVariantSelectorProps {
    onProductVariantSelect: (variant: {
        productVariantId: string;
        productVariantName: string;
        sku: string;
        productAsset: AssetFragment | null;
        price?: number;
        priceWithTax?: number;
    }) => void;
}

export function ProductVariantSelector({ onProductVariantSelect }: Readonly<ProductVariantSelectorProps>) {
    const { t } = useLingui();
    const [search, setSearch] = useState('');
    const [open, setOpen] = useState(false);
    const debouncedSearch = useDebounce(search, 500);
    const anchor = useRef<HTMLButtonElement>(null);
    const labelId = useId();

    const { data, isFetching } = useQuery({
        queryKey: ['productVariants', debouncedSearch],
        enabled: debouncedSearch.length > 0,
        queryFn: () =>
            api.query(productVariantListDocument, {
                options: {
                    take: 10,
                    filter: {
                        name: { contains: debouncedSearch },
                        sku: { contains: debouncedSearch },
                    },
                    filterOperator: 'OR',
                },
            }),
    });
    const variants = debouncedSearch ? (data?.productVariants.items ?? []) : [];
    type Variant = (typeof variants)[number];

    return (
        <Combobox
            items={variants}
            filter={null}
            value={null}
            onValueChange={(variant: Variant | null) => {
                if (!variant) {
                    return;
                }
                onProductVariantSelect({
                    productVariantId: variant.id,
                    productVariantName: variant.name,
                    sku: variant.sku,
                    productAsset: variant.featuredAsset ?? variant.product.featuredAsset ?? null,
                    price: variant.price,
                    priceWithTax: variant.priceWithTax,
                });
                setOpen(false);
            }}
            open={open}
            onOpenChange={setOpen}
            inputValue={search}
            onInputValueChange={setSearch}
            itemToStringLabel={(variant: Variant) => variant.name}
            isItemEqualToValue={(a: Variant, b: Variant) => a.id === b.id}
            isLoading={isFetching || search !== debouncedSearch}
        >
            <ComboboxPrimitive.Trigger
                ref={anchor}
                aria-labelledby={labelId}
                render={<Button variant="outline" type="button" className="w-full" />}
            >
                <span id={labelId}>
                    <Trans>Add item to order</Trans>
                </span>
                <Plus className="opacity-50" />
            </ComboboxPrimitive.Trigger>
            <ComboboxContent anchor={anchor} className="w-80">
                <ComboboxInput
                    aria-label={t`Add item to order`}
                    placeholder={t`Add item to order...`}
                    showTrigger={false}
                />
                <ComboboxEmpty>
                    <Trans>No products found.</Trans>
                </ComboboxEmpty>
                <ComboboxList>
                    {(variant: Variant) => (
                        <ComboboxItem key={variant.id} value={variant}>
                            {variant.featuredAsset && (
                                <VendureImage
                                    asset={variant.featuredAsset}
                                    preset="tiny"
                                    className="size-8 rounded-md object-cover"
                                />
                            )}
                            <span className="flex flex-col">
                                <span className="font-medium">{variant.name}</span>
                                <span className="text-xs text-muted-foreground">{variant.sku}</span>
                            </span>
                        </ComboboxItem>
                    )}
                </ComboboxList>
            </ComboboxContent>
        </Combobox>
    );
}
