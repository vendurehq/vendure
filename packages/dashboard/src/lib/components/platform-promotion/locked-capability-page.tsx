import { Card, CardContent } from '@/vdb/components/ui/card.js';
import { Skeleton } from '@/vdb/components/ui/skeleton.js';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/vdb/components/ui/table.js';
import { Page, PageTitle } from '@/vdb/framework/layout-engine/page-layout.js';
import { getLockedCapability } from '@/vdb/framework/platform-promotion/locked-capabilities.js';
import type { DashboardPromotionV1 } from '@/vdb/framework/platform-promotion/platform-promotion-types.js';
import { usePlatformPromotion } from '@/vdb/hooks/use-platform-promotion.js';
import { Navigate } from '@tanstack/react-router';

import { LockedTierLabel, PlatformPromoPanel } from './platform-promo.js';

const PLACEHOLDER_ROWS = 8;
// Used when the placement names no columns or fields.
const PLACEHOLDER_COUNT = 4;

function PlaceholderList({ columns }: Readonly<{ columns: string[] }>) {
    return (
        <Table>
            <TableHeader>
                <TableRow>
                    {columns.map((column, index) => (
                        <TableHead key={index}>{column}</TableHead>
                    ))}
                </TableRow>
            </TableHeader>
            <TableBody>
                {Array.from({ length: PLACEHOLDER_ROWS }, (_, row) => (
                    <TableRow key={row}>
                        {columns.map((_, index) => (
                            <TableCell key={index}>
                                <Skeleton className="h-4 w-3/4 animate-none" />
                            </TableCell>
                        ))}
                    </TableRow>
                ))}
            </TableBody>
        </Table>
    );
}

function PlaceholderDetail({ fields }: Readonly<{ fields: string[] }>) {
    return (
        <Card>
            <CardContent className="grid gap-6 @md:grid-cols-2">
                {fields.map((field, index) => (
                    <div key={index} className="space-y-2">
                        {field ? (
                            <div className="text-sm font-medium">{field}</div>
                        ) : (
                            <Skeleton className="h-4 w-24 animate-none" />
                        )}
                        <Skeleton className="h-9 w-full animate-none" />
                    </div>
                ))}
            </CardContent>
        </Card>
    );
}

/**
 * The page at the route of a locked Platform page. It copies the layout of the Platform
 * page with placeholder rows only, always blurred, and shows the promo on top.
 */
export function LockedCapabilityPage({
    navItem,
}: Readonly<{ navItem: DashboardPromotionV1['navItems'][number] }>) {
    const state = usePlatformPromotion();
    // License Guard can report the granted set after the page opens. Until then, show nothing.
    if (state.hideAll) {
        return null;
    }
    const promotion = getLockedCapability(state, navItem.capability);
    if (!promotion) {
        return <Navigate to="/" />;
    }
    const { page } = navItem;
    return (
        <Page pageId={`locked-${navItem.id}`}>
            <PageTitle>
                <span className="flex items-center gap-3">
                    {page.title}
                    <LockedTierLabel promotion={promotion} className="text-sm font-normal" />
                </span>
            </PageTitle>
            <div className="relative min-h-[32rem]" data-testid="locked-capability-page">
                <div
                    className="pointer-events-none select-none blur-sm"
                    aria-hidden="true"
                    inert
                    data-testid="locked-capability-placeholder"
                >
                    {page.kind === 'list' ? (
                        <PlaceholderList columns={page.columns ?? Array(PLACEHOLDER_COUNT).fill('')} />
                    ) : (
                        <PlaceholderDetail fields={page.fields ?? Array(PLACEHOLDER_COUNT).fill('')} />
                    )}
                </div>
                <div className="absolute inset-0 flex items-start justify-center p-6">
                    <Card className="w-full max-w-md shadow-lg">
                        <CardContent>
                            <PlatformPromoPanel promotion={promotion} />
                        </CardContent>
                    </Card>
                </div>
            </div>
        </Page>
    );
}
