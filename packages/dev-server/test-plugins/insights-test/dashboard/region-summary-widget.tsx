import {
    DashboardBaseWidget,
    Tabs,
    TabsList,
    TabsTrigger,
    useWidgetConfig,
    useWidgetFilters,
} from '@vendure/dashboard';
import { Trans, useLingui } from '@lingui/react/macro';

import { REGION_FILTER_ID, useRegionLabel } from './region-filter';

export const REGION_SUMMARY_WIDGET_ID = 'insights-test-region-summary';

type SummaryUnit = 'orders' | 'revenue';

interface RegionSummaryConfig extends Record<string, unknown> {
    unit: SummaryUnit;
}

/**
 * The `defaultConfig` for this widget. The effective config seen at runtime is this
 * object merged with any per-instance overrides the user persists via `useWidgetConfig`.
 */
export const REGION_SUMMARY_DEFAULT_CONFIG: RegionSummaryConfig = {
    unit: 'orders',
};

/**
 * Demonstrates two APIs at once:
 *
 * - `useWidgetConfig` — the orders/revenue toggle is persisted per instance, so the
 *   selection survives a page reload (independent of "Save Layout").
 * - `useWidgetFilters` — the widget reads the global region filter registered by this
 *   plugin and visibly reflects the current selection.
 */
export function RegionSummaryWidget() {
    const { t } = useLingui();
    const regionLabel = useRegionLabel();
    const { filters } = useWidgetFilters();
    const [config, setConfig] = useWidgetConfig<RegionSummaryConfig>();

    const region = (filters[REGION_FILTER_ID] as string) ?? 'all';

    return (
        <DashboardBaseWidget
            id={REGION_SUMMARY_WIDGET_ID}
            title={t`Region Summary`}
            description={t`Reads the global region filter and a persisted unit toggle`}
            actions={
                <Tabs value={config.unit} onValueChange={value => setConfig({ unit: value as SummaryUnit })}>
                    <TabsList>
                        <TabsTrigger value="orders">
                            <Trans>Orders</Trans>
                        </TabsTrigger>
                        <TabsTrigger value="revenue">
                            <Trans>Revenue</Trans>
                        </TabsTrigger>
                    </TabsList>
                </Tabs>
            }
        >
            <div className="flex h-full flex-col justify-center gap-2 px-2">
                <div className="text-sm text-muted-foreground">
                    <Trans>Active region filter</Trans>
                </div>
                <div className="text-2xl font-semibold">{regionLabel(region)}</div>
                <div className="text-sm text-muted-foreground">
                    {config.unit === 'revenue' ? (
                        <Trans>Showing revenue for this region</Trans>
                    ) : (
                        <Trans>Showing orders for this region</Trans>
                    )}
                </div>
            </div>
        </DashboardBaseWidget>
    );
}
