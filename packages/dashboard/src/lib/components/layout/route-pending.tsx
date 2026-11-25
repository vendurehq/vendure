import { Card, CardContent } from '@/vdb/components/ui/card.js';
import { PageHeader, PageHeaderActions, PageHeaderContent } from '@/vdb/components/ui/page-header.js';
import { Skeleton } from '@/vdb/components/ui/skeleton.js';
import { Spinner } from '@/vdb/components/ui/spinner.js';
import { AUTHENTICATED_ROUTE_PREFIX } from '@/vdb/constants.js';
import { Trans } from '@lingui/react/macro';
import { useMatch } from '@tanstack/react-router';
import React from 'react';

const LIST_ROWS = 10;

/**
 * The page frame of `Page`: the same margin, gap and header row, with a
 * skeleton title and action.
 */
function PageSkeleton({
    kind,
    actionWidth,
    children,
}: Readonly<{ kind: 'list' | 'detail'; actionWidth: string; children: React.ReactNode }>) {
    return (
        <div className="m-4 space-y-4" data-skeleton={kind}>
            <span className="sr-only" role="status">
                <Trans>Loading…</Trans>
            </span>
            <PageHeader className="items-center" aria-hidden="true">
                <PageHeaderContent>
                    <Skeleton className="h-8 w-48" />
                </PageHeaderContent>
                <PageHeaderActions>
                    <Skeleton className={`h-8 ${actionWidth}`} />
                </PageHeaderActions>
            </PageHeader>
            <div aria-hidden="true">{children}</div>
        </div>
    );
}

/**
 * The shape of a list page while its route loads: the title row, then the
 * table card with its toolbar and rows.
 */
export function ListPageSkeleton() {
    return (
        <PageSkeleton kind="list" actionWidth="w-32">
            <Card className="gap-0 py-0">
                <div className="flex items-center justify-between gap-2 px-4 py-4">
                    <Skeleton className="h-6 w-12" />
                    <div className="flex items-center gap-2">
                        <Skeleton className="h-8 w-64 max-sm:hidden" />
                        <Skeleton className="h-8 w-20" />
                    </div>
                </div>
                {Array.from({ length: LIST_ROWS }, (_, index) => (
                    <div key={index} className="flex items-center gap-4 border-t px-4 py-4">
                        <Skeleton className="h-4 flex-1" />
                        <Skeleton className="h-4 flex-1" />
                        <Skeleton className="h-4 flex-1 max-sm:hidden" />
                        <Skeleton className="h-4 w-20" />
                    </div>
                ))}
            </Card>
        </PageSkeleton>
    );
}

function FieldSkeleton({ className }: Readonly<{ className?: string }>) {
    return (
        <div className="space-y-2">
            <Skeleton className="h-4 w-24" />
            <Skeleton className={className ?? 'h-9 w-full'} />
        </div>
    );
}

function SideCardSkeleton({ rows }: Readonly<{ rows: number }>) {
    return (
        <Card>
            <CardContent className="space-y-3">
                <Skeleton className="h-4 w-28" />
                {Array.from({ length: rows }, (_, index) => (
                    <Skeleton key={index} className="h-6 w-full" />
                ))}
            </CardContent>
        </Card>
    );
}

/**
 * The shape of a detail page while its route loads: the title row, the main
 * card with form rows, and the side column, in the grid of `PageLayout`.
 */
export function DetailPageSkeleton() {
    return (
        <PageSkeleton kind="detail" actionWidth="w-20">
            <div className="@container/layout w-full">
                <div className="grid grid-cols-1 gap-4 @3xl/layout:grid-cols-4">
                    <Card className="@3xl/layout:col-span-3">
                        <CardContent className="space-y-6">
                            <div className="grid gap-6 @md:grid-cols-2">
                                <FieldSkeleton />
                                <FieldSkeleton />
                            </div>
                            <FieldSkeleton className="h-28 w-full" />
                            <div className="grid gap-6 @md:grid-cols-2">
                                <FieldSkeleton />
                                <FieldSkeleton />
                            </div>
                        </CardContent>
                    </Card>
                    <div className="space-y-4 @3xl/layout:col-span-1">
                        <SideCardSkeleton rows={2} />
                        <SideCardSkeleton rows={3} />
                    </div>
                </div>
            </div>
        </PageSkeleton>
    );
}

/**
 * The spinner for a pending route that is not a page of the app shell: the
 * shell itself and the sign-in pages.
 */
function RouteSpinner() {
    return (
        <div
            className="flex items-center justify-center w-full text-muted-foreground"
            style={{ minHeight: '60vh' }}
            role="status"
        >
            <Spinner />
            <span className="sr-only">
                <Trans>Loading…</Trans>
            </span>
        </div>
    );
}

/**
 * The pending component of every route. A page of the app shell gets the shape
 * of a detail page when its path has a param, else of a list page. The home
 * page and the routes outside the shell get a spinner.
 */
export function RoutePending() {
    const { routeId } = useMatch({ strict: false });
    if (
        !routeId.startsWith(`${AUTHENTICATED_ROUTE_PREFIX}/`) ||
        routeId === `${AUTHENTICATED_ROUTE_PREFIX}/`
    ) {
        return <RouteSpinner />;
    }
    return routeId.includes('/$') ? <DetailPageSkeleton /> : <ListPageSkeleton />;
}
