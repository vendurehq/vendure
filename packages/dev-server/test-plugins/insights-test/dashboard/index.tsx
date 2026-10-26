import { defineDashboardExtension } from '@vendure/dashboard';

import { RegionFilter, REGION_FILTER_ID } from './region-filter';
import {
    RegionSummaryWidget,
    REGION_SUMMARY_DEFAULT_CONFIG,
    REGION_SUMMARY_WIDGET_ID,
} from './region-summary-widget';
import { StickyNoteWidget, STICKY_NOTE_DEFAULT_CONFIG, STICKY_NOTE_WIDGET_ID } from './sticky-note-widget';

defineDashboardExtension({
    insights: {
        widgets: [
            {
                // Responds to the global region filter below.
                id: REGION_SUMMARY_WIDGET_ID,
                name: 'Region Summary (test)',
                component: RegionSummaryWidget,
                defaultSize: { w: 3, h: 3 },
                defaultConfig: REGION_SUMMARY_DEFAULT_CONFIG,
            },
            {
                // Instances are differentiated purely via their persisted config (the tone).
                id: STICKY_NOTE_WIDGET_ID,
                name: 'Sticky Note (test)',
                component: StickyNoteWidget,
                defaultSize: { w: 3, h: 3 },
                defaultConfig: STICKY_NOTE_DEFAULT_CONFIG,
                allowMultipleInstances: true,
            },
        ],
        // Its value flows to every widget via useWidgetFilters().filters[REGION_FILTER_ID].
        filters: [
            {
                id: REGION_FILTER_ID,
                component: RegionFilter,
                defaultValue: 'all',
            },
        ],
        // Uncomment to hard-remove a built-in widget:
        // excludeWidgets: ['top-products-widget'],
    },
});
