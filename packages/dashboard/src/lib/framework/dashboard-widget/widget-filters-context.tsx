import { createContext, PropsWithChildren } from 'react';

export interface DefinedDateRange {
    from: Date;
    to: Date;
}

export interface WidgetFilters {
    dateRange: DefinedDateRange;
}

export const WidgetFiltersContext = createContext<WidgetFilters | undefined>(undefined);

export function WidgetFiltersProvider({ children, filters }: PropsWithChildren<{ filters: WidgetFilters }>) {
    return <WidgetFiltersContext.Provider value={filters}>{children}</WidgetFiltersContext.Provider>;
}
