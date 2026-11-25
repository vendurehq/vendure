import { Card, CardContent } from '@/vdb/components/ui/card.js';
import { PageHeader, PageHeaderActions, PageHeaderContent } from '@/vdb/components/ui/page-header.js';
import { Skeleton } from '@/vdb/components/ui/skeleton.js';
import { Trans } from '@lingui/react/macro';
import { useParams } from '@tanstack/react-router';
import React from 'react';

const LIST_ROWS = 10;

/**
 * The page frame of `Page`: the same margin, gap and header row, with a
 * skeleton title and action.
 */
function PageSkeleton({
    actionWidth,
    children,
}: Readonly<{ actionWidth: string; children: React.ReactNode }>) {
    return (
        <div className="m-4 space-y-4" aria-busy="true">
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
        <PageSkeleton actionWidth="w-32">
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
        <PageSkeleton actionWidth="w-20">
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
 * The pending component of every route. A route with an `id` param is a detail
 * page, every other route a list page.
 */
export function RoutePending() {
    const params: Record<string, unknown> = useParams({ strict: false });
    return params.id ? <DetailPageSkeleton /> : <ListPageSkeleton />;
}
