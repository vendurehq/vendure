import { useIsFetching, useQueryClient } from '@tanstack/react-query';
import { useCallback, useEffect, useState } from 'react';

/**
 * @description
 * Shared React Query key prefix for every Insights widget data query. The page-level refresh
 * invalidates all queries whose key starts with this prefix, so a widget opts into page-level
 * refresh simply by prefixing its `queryKey` with it, e.g.
 * `queryKey: [INSIGHTS_WIDGET_QUERY_KEY, 'my-widget', dateRange]`.
 */
export const INSIGHTS_WIDGET_QUERY_KEY = 'insights-widget';

const DEFAULT_POLL_INTERVAL_MS = 60_000;

export interface UseInsightsRefreshOptions {
    /**
     * Auto-refresh is paused while this is `false` (e.g. while the layout is being edited).
     */
    enabled?: boolean;
    /**
     * How often, in milliseconds, the auto-refresh runs. Defaults to 60s.
     */
    intervalMs?: number;
}

export interface InsightsRefresh {
    /** Triggers an immediate refresh of every widget. */
    refresh: () => void;
    /** True while a manually-triggered refresh is still settling. */
    isRefreshing: boolean;
}

/**
 * Page-level refresh signal for the Insights page. Refetches every widget by invalidating the
 * shared {@link INSIGHTS_WIDGET_QUERY_KEY} prefix rather than mutating a token in each widget's
 * query key. Because the query keys stay stable, React Query refetches the existing cache entries
 * in place (data is retained, no spinner flicker) instead of minting a fresh, empty entry — and no
 * dead cache entry accumulates per tick.
 *
 * Refresh is triggered both by {@link InsightsRefresh.refresh} (the action-bar button) and on an
 * interval while `enabled`. Polling is paused when the tab is hidden and while disabled (edit
 * mode), keeping to the dashboard convention that background refetching is explicit rather than
 * implicit (`refetchOnWindowFocus` is globally off).
 */
export function useInsightsRefresh({
    enabled = true,
    intervalMs = DEFAULT_POLL_INTERVAL_MS,
}: UseInsightsRefreshOptions = {}): InsightsRefresh {
    const queryClient = useQueryClient();
    const [manualRefreshPending, setManualRefreshPending] = useState(false);
    // Scoped to Insights widget queries so an unrelated app-wide fetch doesn't make the button busy.
    const isFetching = useIsFetching({ queryKey: [INSIGHTS_WIDGET_QUERY_KEY] });

    const refetchWidgets = useCallback(
        () => queryClient.invalidateQueries({ queryKey: [INSIGHTS_WIDGET_QUERY_KEY] }),
        [queryClient],
    );

    const refresh = useCallback(() => {
        setManualRefreshPending(true);
        void refetchWidgets();
    }, [refetchWidgets]);

    // The short delay after `isFetching` reaches 0 bridges the tick between invalidating and the
    // queries actually starting to refetch, so the spinner does not flicker off immediately.
    useEffect(() => {
        if (!manualRefreshPending || isFetching > 0) {
            return;
        }
        const timer = setTimeout(() => setManualRefreshPending(false), 150);
        return () => clearTimeout(timer);
    }, [manualRefreshPending, isFetching]);

    // Auto-refresh on an interval, but only while the page is enabled and the tab is visible.
    useEffect(() => {
        if (!enabled) {
            return;
        }
        let intervalId: ReturnType<typeof setInterval> | undefined;
        const start = () => {
            if (intervalId === undefined) {
                intervalId = setInterval(() => void refetchWidgets(), intervalMs);
            }
        };
        const stop = () => {
            if (intervalId !== undefined) {
                clearInterval(intervalId);
                intervalId = undefined;
            }
        };
        const sync = () => (document.visibilityState === 'visible' ? start() : stop());
        sync();
        document.addEventListener('visibilitychange', sync);
        return () => {
            stop();
            document.removeEventListener('visibilitychange', sync);
        };
    }, [enabled, intervalMs, refetchWidgets]);

    return { refresh, isRefreshing: manualRefreshPending };
}
