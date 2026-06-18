import { DateRangePicker } from '@/vdb/components/date-range-picker.js';
import { Button } from '@/vdb/components/ui/button.js';
import type { GridLayout as GridLayoutType } from '@/vdb/components/ui/grid-layout.js';
import { GridLayout } from '@/vdb/components/ui/grid-layout.js';
import { getDashboardWidget, getDashboardWidgetRegistry } from '@/vdb/framework/dashboard-widget/widget-extensions.js';
import { usePermissions } from '@/vdb/hooks/use-permissions.js';
import { DefinedDateRange, WidgetFiltersProvider, } from '@/vdb/framework/dashboard-widget/widget-filters-context.js';
import { DashboardWidgetInstance } from '@/vdb/framework/extension-api/types/widgets.js';
import {
    FullWidthPageBlock,
    Page,
    PageActionBar,
    PageLayout,
    PageTitle,
} from '@/vdb/framework/layout-engine/page-layout.js';
import { ActionBarItem } from '@/vdb/framework/layout-engine/action-bar-item-wrapper.js';
import { useUserSettings } from '@/vdb/hooks/use-user-settings.js';
import { createFileRoute } from '@tanstack/react-router';
import { endOfDay, startOfMonth } from 'date-fns';
import { useEffect, useRef, useState } from 'react';
import { Trans, useLingui } from '@lingui/react/macro';

export const Route = createFileRoute('/_authenticated/')({
    component: DashboardPage,
});

const findNextPosition = (
    existingWidgets: DashboardWidgetInstance[],
    newWidgetSize: { w: number; h: number },
) => {
    const occupied = new Set();
    let maxExistingRow = 0;

    existingWidgets.forEach(widget => {
        const { x, y, w, h } = widget.layout;
        maxExistingRow = Math.max(maxExistingRow, y + h);

        for (let i = x; i < x + w; i++) {
            for (let j = y; j < y + h; j++) {
                occupied.add(`${i},${j}`);
            }
        }
    });

    const maxSearchRows = maxExistingRow + 3;

    for (let y = 0; y < maxSearchRows; y++) {
        for (let x = 0; x <= 12 - newWidgetSize.w; x++) {
            let fits = true;
            for (let i = x; i < x + newWidgetSize.w; i++) {
                for (let j = y; j < y + newWidgetSize.h; j++) {
                    if (occupied.has(`${i},${j}`)) {
                        fits = false;
                        break;
                    }
                }
                if (!fits) break;
            }
            if (fits) {
                return { x, y };
            }
        }
    }
    return { x: 0, y: maxExistingRow };
};

function DashboardPage() {
    const [widgets, setWidgets] = useState<DashboardWidgetInstance[]>([]);
    const [editMode, setEditMode] = useState(false);
    const [isInitialized, setIsInitialized] = useState(false);
    const prevEditModeRef = useRef(editMode);
    const { t } = useLingui();
    const [dateRange, setDateRange] = useState<DefinedDateRange>({
        from: startOfMonth(new Date()),
        to: endOfDay(new Date()),
    });

    const { settings, setWidgetLayout } = useUserSettings();
    const { hasPermissions } = usePermissions();

    useEffect(() => {
        const savedLayouts = settings.widgetLayout || {};

        const initialWidgets = Array.from(getDashboardWidgetRegistry().entries())
            .filter(([, widget]) => {
                if (!widget.requiresPermissions || widget.requiresPermissions.length === 0) {
                    return true;
                }
                return hasPermissions(widget.requiresPermissions);
            })
            .reduce(
            (acc: DashboardWidgetInstance[], [id, widget]) => {
                const defaultSize = {
                    w: widget.defaultSize.w ?? 4, // Default 4 columns
                    h: widget.defaultSize.h ?? 3, // Default 3 rows
                };

                // Use minSize if specified, otherwise fall back to defaultSize
                const minSize = {
                    w: widget.minSize?.w ?? defaultSize.w,
                    h: widget.minSize?.h ?? defaultSize.h,
                };

                // Check if we have a saved layout for this widget
                const savedLayout = savedLayouts[id];

                const layout = {
                    w: savedLayout?.w ?? defaultSize.w,
                    h: savedLayout?.h ?? defaultSize.h,
                    x: savedLayout?.x ?? widget.defaultSize.x ?? 0,
                    y: savedLayout?.y ?? widget.defaultSize.y ?? 0,
                    minW: minSize.w,
                    minH: minSize.h,
                    maxW: widget.maxSize?.w,
                    maxH: widget.maxSize?.h,
                };

                // Only find next position if we don't have a saved layout
                if (!savedLayout) {
                    const pos = findNextPosition(acc, {
                        w: layout.w,
                        h: layout.h,
                    });
                    layout.x = pos.x;
                    layout.y = pos.y;
                }

                return [
                    ...acc,
                    {
                        id,
                        widgetId: id,
                        layout,
                    },
                ];
            },
            [],
        );

        setWidgets(initialWidgets);
        setIsInitialized(true);
    }, [settings.widgetLayout, hasPermissions]);

    // Save layout when edit mode is turned off
    useEffect(() => {
        // Only save when transitioning from edit mode ON to OFF
        if (prevEditModeRef.current && !editMode && isInitialized && widgets.length > 0) {
            const layoutConfig: Record<string, { x: number; y: number; w: number; h: number }> = {};
            widgets.forEach(widget => {
                layoutConfig[widget.widgetId] = {
                    x: widget.layout.x,
                    y: widget.layout.y,
                    w: widget.layout.w,
                    h: widget.layout.h,
                };
            });
            setWidgetLayout(layoutConfig);
        }

        // Update the ref for next render
        prevEditModeRef.current = editMode;
    }, [editMode, isInitialized, widgets, setWidgetLayout]);

    const handleLayoutChange = (layouts: GridLayoutType[]) => {
        setWidgets(prev =>
            prev.map((widget, i) => ({
                ...widget,
                layout: layouts[i] || widget.layout,
            })),
        );
    };

    const renderWidget = (widget: DashboardWidgetInstance) => {
        const definition = getDashboardWidget(widget.widgetId);
        if (!definition) return null;
        const WidgetComponent = definition.component;

        return <WidgetComponent key={widget.id} id={widget.id} config={widget.config} />;
    };

    return (
        <Page pageId="insights">
            <PageTitle>
                <Trans>Insights</Trans>
            </PageTitle>
            <PageActionBar>
                <ActionBarItem itemId="date-range-picker">
                    <DateRangePicker
                        dateRange={dateRange}
                        onDateRangeChange={setDateRange}
                        className="mr-2"
                    />
                </ActionBarItem>
                <ActionBarItem itemId="edit-layout-button">
                    <Button
                        variant={editMode ? 'default' : 'outline'}
                        onClick={() => setEditMode(prev => !prev)}
                    >
                        {editMode ? t`Save Layout` : t`Edit Layout`}
                    </Button>
                </ActionBarItem>
            </PageActionBar>
            <PageLayout>
                <FullWidthPageBlock blockId="widgets">
                    <div className="w-full">
                        {widgets.length > 0 ? (
                            <WidgetFiltersProvider filters={{ dateRange }}>
                                <GridLayout
                                    layouts={widgets.map(w => ({ ...w.layout, i: w.id }))}
                                    onLayoutChange={handleLayoutChange}
                                    cols={12}
                                    rowHeight={100}
                                    isDraggable={editMode}
                                    isResizable={editMode}
                                    className="min-h-[400px]"
                                    gutter={10}
                                >
                                    {
                                        widgets
                                            .map(widget => renderWidget(widget))
                                            .filter(Boolean) as React.ReactElement[]
                                    }
                                </GridLayout>
                            </WidgetFiltersProvider>
                        ) : (
                            <div
                                className="flex items-center justify-center text-muted-foreground"
                                style={{ height: '400px' }}
                            >
                                <Trans>No widgets available</Trans>
                            </div>
                        )}
                    </div>
                </FullWidthPageBlock>
            </PageLayout>
        </Page>
    );
}
