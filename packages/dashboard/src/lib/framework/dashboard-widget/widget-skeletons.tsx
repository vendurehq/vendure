import { Skeleton } from '@/vdb/components/ui/skeleton.js';
import { Trans } from '@lingui/react/macro';
import {
    ListRow,
    ListRowContent,
    ListRowLeading,
    ListRowTrailing,
} from '@vendure-io/ui/components/molecules/list-row';

const Y_TICKS = 5;
const X_TICKS = 8;
const X_GRID_LINES = 4;
// Titles of different lengths, so the rows read as a list of names, not as a table.
const TITLE_WIDTHS = [70, 55, 62, 48, 66, 52];

/**
 * The status text a screen reader announces while a widget loads. The skeletons
 * next to it are hidden from assistive technology.
 */
function LoadingStatus() {
    return (
        <span className="sr-only" role="status">
            <Trans>Loading…</Trans>
        </span>
    );
}

/**
 * The shape of `MetricsChart` while its data loads, in the geometry of its
 * Recharts defaults: a 5px margin, a 60px y-axis with each label centred on
 * its grid line, a 30px x-axis, the dashed grid in both directions, and a
 * flat area at the bottom. It fills the widget, like the chart.
 */
export function ChartSkeleton() {
    const yPositions = Array.from({ length: Y_TICKS }, (_, index) => (index / (Y_TICKS - 1)) * 100);
    return (
        <div className="flex h-full w-full flex-col p-1.25">
            <LoadingStatus />
            <div className="flex min-h-0 flex-1" aria-hidden="true">
                <div className="relative w-15">
                    {yPositions.map(top => (
                        <Skeleton
                            key={top}
                            className="absolute end-2 h-3 w-10 -translate-y-1/2"
                            style={{ top: `${top}%` }}
                        />
                    ))}
                </div>
                <div className="relative flex-1 border-s border-b border-border">
                    {yPositions.slice(0, -1).map(top => (
                        <div
                            key={top}
                            className="absolute inset-x-0 border-t border-dashed border-border"
                            style={{ top: `${top}%` }}
                        />
                    ))}
                    {Array.from({ length: X_GRID_LINES }, (_, index) => (
                        <div
                            key={index}
                            className="absolute inset-y-0 border-s border-dashed border-border"
                            style={{ left: `${((index + 1) / (X_GRID_LINES + 1)) * 100}%` }}
                        />
                    ))}
                    <Skeleton className="absolute inset-x-0 bottom-0 h-1/4 rounded-none" />
                </div>
            </div>
            <div className="flex h-7.5 items-start justify-between gap-2 ps-15 pt-2" aria-hidden="true">
                {Array.from({ length: X_TICKS }, (_, index) => (
                    <Skeleton key={index} className="h-3 w-10 min-w-0 shrink" />
                ))}
            </div>
        </div>
    );
}

/**
 * The shape of a widget list while it loads: rows of the `ListRow` molecule,
 * so each row has the height of the row that replaces it. `ranked` adds the
 * rank column and `meta` the second line. `trailing` is the value on the
 * right: a line of text, or a `StatusBadge`. `trailingWidth` is its width class.
 */
export function ListRowsSkeleton({
    rows,
    ranked = false,
    meta = false,
    trailing = 'text',
    trailingWidth = 'w-12',
}: Readonly<{
    rows: number;
    ranked?: boolean;
    meta?: boolean;
    trailing?: 'text' | 'badge';
    trailingWidth?: `w-${string}`;
}>) {
    const trailingClassName =
        trailing === 'badge' ? `h-6 rounded-lg ${trailingWidth}` : `h-4 ${trailingWidth}`;
    return (
        <div className="-ms-(--card-ps) -me-(--card-px)">
            <LoadingStatus />
            <div aria-hidden="true">
                {Array.from({ length: rows }, (_, index) => (
                    // A meta line makes ListRow 60px high through its ListRowMeta; py-2.5 gives a skeleton row the same height.
                    <ListRow key={index} className={meta ? 'py-2.5' : undefined}>
                        {ranked && (
                            <ListRowLeading className="w-5 justify-end">
                                <Skeleton className="h-3 w-3" />
                            </ListRowLeading>
                        )}
                        <ListRowContent>
                            <div className="flex h-5 items-center">
                                <Skeleton
                                    className="h-3.5"
                                    style={{ width: `${TITLE_WIDTHS[index % TITLE_WIDTHS.length]}%` }}
                                />
                            </div>
                            {meta && (
                                <div className="flex h-4.5 items-center">
                                    <Skeleton className="h-3 w-2/5" />
                                </div>
                            )}
                        </ListRowContent>
                        <ListRowTrailing>
                            <Skeleton className={trailingClassName} />
                        </ListRowTrailing>
                        {/* Holds the place of ListRowChevron. */}
                        <div className="size-3.75 shrink-0" />
                    </ListRow>
                ))}
            </div>
        </div>
    );
}
