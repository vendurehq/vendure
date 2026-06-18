import { WidgetFiltersContext } from '@/vdb/framework/dashboard-widget/widget-filters-context.js';
import { useLingui } from '@lingui/react/macro';
import { useContext } from 'react';

/**
 * @description
 * Exposes a context object for use in building Insights page widgets.
 *
 * @docsCategory hooks
 * @docsPage useWidgetFilters
 * @since 3.5.0
 */
export function useWidgetFilters() {
    const { t } = useLingui();
    const context = useContext(WidgetFiltersContext);
    if (context === undefined) {
        throw new Error(t`useWidgetFilters must be used within a WidgetFiltersProvider`);
    }
    return context;
}
