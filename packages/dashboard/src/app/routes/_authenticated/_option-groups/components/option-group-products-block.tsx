import { DetailPageButton } from '@/vdb/components/shared/detail-page-button.js';
import { Input } from '@/vdb/components/ui/input.js';
import { api } from '@/vdb/graphql/api.js';
import { Trans, useLingui } from '@lingui/react/macro';
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { useDebounce } from '@uidotdev/usehooks';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import { useState } from 'react';
import { Button } from '@/vdb/components/ui/button.js';
import { productsByOptionGroupDocument } from '../option-groups.graphql.js';

const PAGE_SIZE = 10;

export function OptionGroupProductsBlock({
    optionGroupId,
}: Readonly<{
    optionGroupId: string;
}>) {
    const { t } = useLingui();
    const [searchTerm, setSearchTerm] = useState('');
    const [page, setPage] = useState(1);
    const debouncedSearchTerm = useDebounce(searchTerm, 300);

    const { data, isFetching } = useQuery({
        queryKey: ['optionGroupProducts', optionGroupId, debouncedSearchTerm, page],
        queryFn: () =>
            api.query(productsByOptionGroupDocument, {
                options: {
                    filter: {
                        optionGroupId: { eq: optionGroupId },
                        ...(debouncedSearchTerm ? { name: { contains: debouncedSearchTerm } } : {}),
                    },
                    take: PAGE_SIZE,
                    skip: (page - 1) * PAGE_SIZE,
                },
            }),
        placeholderData: keepPreviousData,
    });

    const items = data?.products?.items ?? [];
    const totalItems = data?.products?.totalItems ?? 0;
    const totalPages = Math.ceil(totalItems / PAGE_SIZE);
    const hasMultiplePages = totalPages > 1;

    return (
        <div className="space-y-2">
            <Input
                placeholder={t`Filter...`}
                value={searchTerm}
                onChange={e => {
                    setSearchTerm(e.target.value);
                    setPage(1);
                }}
                className="h-8"
            />
            <div className="divide-y rounded-md border">
                {isFetching && items.length === 0 ? (
                    <div className="p-3 text-sm text-muted-foreground text-center">
                        <Trans>Loading...</Trans>
                    </div>
                ) : items.length === 0 ? (
                    <div className="p-3 text-sm text-muted-foreground text-center">
                        <Trans>No products found</Trans>
                    </div>
                ) : (
                    items.map(item => (
                        <div key={item.id} className="px-1 py-0.5">
                            <DetailPageButton
                                id={item.id}
                                label={item.name}
                                href={`/products/${item.id}`}
                            />
                        </div>
                    ))
                )}
            </div>
            {hasMultiplePages && (
                <div className="flex items-center justify-between text-sm text-muted-foreground">
                    <span>
                        <Trans>
                            Page {page} of {totalPages}
                        </Trans>
                    </span>
                    <div className="flex items-center gap-1">
                        <Button
                            variant="outline"
                            size="icon"
                            className="h-7 w-7"
                            disabled={page <= 1}
                            onClick={() => setPage(p => p - 1)}
                        >
                            <ChevronLeft className="h-4 w-4" />
                        </Button>
                        <Button
                            variant="outline"
                            size="icon"
                            className="h-7 w-7"
                            disabled={page >= totalPages}
                            onClick={() => setPage(p => p + 1)}
                        >
                            <ChevronRight className="h-4 w-4" />
                        </Button>
                    </div>
                </div>
            )}
        </div>
    );
}
