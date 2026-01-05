import {
    Command,
    CommandEmpty,
    CommandGroup,
    CommandInput,
    CommandItem,
    CommandList,
} from '@/vdb/components/ui/command.js';
import { Popover, PopoverContent, PopoverTrigger } from '@/vdb/components/ui/popover.js';
import { api } from '@/vdb/graphql/api.js';
import { AssetFragment, assetFragment } from '@/vdb/graphql/fragments.js';
import { graphql } from '@/vdb/graphql/graphql.js';
import { useQuery } from '@tanstack/react-query';
import { useDebounce } from '@uidotdev/usehooks';
import { Trans } from '@lingui/react/macro';
import { Plus } from 'lucide-react';
import { useState } from 'react';
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
    const [search, setSearch] = useState('');
    const [open, setOpen] = useState(false);
    const debouncedSearch = useDebounce(search, 500);

    const { data } = useQuery({
        queryKey: ['productVariants', debouncedSearch],
        staleTime: 1000 * 60 * 5,
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

    return (
        <Popover open={open} onOpenChange={setOpen}>
            <PopoverTrigger asChild>
                <Button variant="outline" role="combobox" className="w-full">
                    <Trans>Add item to order</Trans>
                    <Plus className="opacity-50" />
                </Button>
            </PopoverTrigger>
            <PopoverContent className="p-0">
                <Command shouldFilter={false}>
                    <CommandInput
                        placeholder="Add item to order..."
                        className="h-9"
                        onValueChange={value => setSearch(value)}
                    />
                    <CommandList>
                        <CommandEmpty>No products found.</CommandEmpty>
                        <CommandGroup>
                            {data?.productVariants.items.map(variant => (
                                <CommandItem
                                    key={variant.id}
                                    value={variant.id}
                                    onSelect={() => {
                                        onProductVariantSelect({
                                            productVariantId: variant.id,
                                            productVariantName: variant.name,
                                            sku: variant.sku,
                                            productAsset:
                                                variant.featuredAsset ??
                                                variant.product.featuredAsset ??
                                                null,
                                            price: variant.price,
                                            priceWithTax: variant.priceWithTax,
                                        });
                                        setOpen(false);
                                    }}
                                    className="flex items-center gap-2 p-2"
                                >
                                    {variant.featuredAsset && (
                                        <VendureImage
                                            asset={variant.featuredAsset}
                                            preset="tiny"
                                            className="size-8 rounded-md object-cover"
                                        />
                                    )}
                                    <div className="flex flex-col">
                                        <span className="text-sm font-medium">{variant.name}</span>
                                        <span className="text-xs text-muted-foreground">{variant.sku}</span>
                                    </div>
                                </CommandItem>
                            ))}
                        </CommandGroup>
                    </CommandList>
                </Command>
            </PopoverContent>
        </Popover>
    );
}
