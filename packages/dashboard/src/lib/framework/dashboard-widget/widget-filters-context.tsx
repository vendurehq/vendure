import { createContext, PropsWithChildren } from 'react';

export interface DefinedDateRange {
    from: Date;
    to: Date;
}

export interface WidgetFilters {
    /**
     * @description
     * The date range selected in the built-in Insights date range picker.
     */
    dateRange: DefinedDateRange;
    /**
     * @description
     * The current values of the global Insights filters registered via
     * `insights.filters`, keyed by filter id. Read a specific filter's value with
     * `useWidgetFilters().filters[id]`.
     */
    filters: Record<string, unknown>;
}

export const WidgetFiltersContext = createContext<WidgetFilters | undefined>(undefined);

export function WidgetFiltersProvider({ children, filters }: PropsWithChildren<{ filters: WidgetFilters }>) {
    return <WidgetFiltersContext.Provider value={filters}>{children}</WidgetFiltersContext.Provider>;
}
