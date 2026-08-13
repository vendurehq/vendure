import { DateRangePicker } from '@/vdb/components/date-range-picker.js';
import { Button } from '@/vdb/components/ui/button.js';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/vdb/components/ui/tooltip.js';
import {
    DropdownMenu,
    DropdownMenuContent,
    DropdownMenuItem,
    DropdownMenuTrigger,
} from '@/vdb/components/ui/dropdown-menu.js';
import type { GridLayout as GridLayoutType } from '@/vdb/components/ui/grid-layout.js';
import {
    compactLayouts,
    findNextAvailablePosition,
    GridLayout,
    insertWithReflow,
    tidyLayouts,
} from '@/vdb/components/ui/grid-layout.js';
import {
    getDashboardWidget,
    getDashboardWidgetFilters,
    getVisibleDashboardWidgets,
} from '@/vdb/framework/dashboard-widget/widget-extensions.js';
import { usePermissions } from '@/vdb/hooks/use-permissions.js';
import { DefinedDateRange, WidgetFiltersProvider, } from '@/vdb/framework/dashboard-widget/widget-filters-context.js';
import { WidgetInstanceProvider } from '@/vdb/framework/dashboard-widget/widget-instance-context.js';
import {
    buildInitialWidgetState,
    buildWidgetInstance,
    mergeHiddenWidgetIds,
} from '@/vdb/framework/dashboard-widget/insights-layout.js';
import { DashboardWidgetDefinition, DashboardWidgetInstance } from '@/vdb/framework/extension-api/types/widgets.js';
import {
    FullWidthPageBlock,
    Page,
    PageActionBar,
    PageLayout,
    PageTitle,
} from '@/vdb/framework/layout-engine/page-layout.js';
import { ActionBarItem } from '@/vdb/framework/layout-engine/action-bar-item-wrapper.js';
import { useInsightsRefresh } from '@/vdb/hooks/use-insights-refresh.js';
import { useUserSettings } from '@/vdb/hooks/use-user-settings.js';
import { createFileRoute } from '@tanstack/react-router';
import { endOfDay, startOfMonth } from 'date-fns';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Trans, useLingui } from '@lingui/react/macro';
import { useLingui as useLinguiRuntime } from '@lingui/react';
import { PlusIcon, RefreshCw, Sparkles, SquarePen, XIcon } from 'lucide-react';

export const Route = createFileRoute('/_authenticated/')({
    component: DashboardPage,
});

// Multi-instance widgets keep a unique instanceId; single-instance widgets keep instanceId === widgetId.
const generateInstanceId = (widgetId: string) => `${widgetId}:${crypto.randomUUID()}`;

const toGridLayout = (widget: DashboardWidgetInstance): GridLayoutType => ({
    ...widget.layout,
    i: widget.id,
});

const applyGridLayouts = (
    instances: DashboardWidgetInstance[],
    grid: GridLayoutType[],
): DashboardWidgetInstance[] =>
    instances.map(instance => {
        const layout = grid.find(g => g.i === instance.id);
        return layout
            ? { ...instance, layout: { ...instance.layout, x: layout.x, y: layout.y, w: layout.w, h: layout.h } }
            : instance;
    });

function DashboardPage() {
    const [widgets, setWidgets] = useState<DashboardWidgetInstance[]>([]);
    // Hidden widgets keep their layout so re-adding restores position/size.
    const [hiddenWidgets, setHiddenWidgets] = useState<DashboardWidgetInstance[]>([]);
    // Widget ids the user is permitted to see, captured on load so the save step
    // knows which widgets it "owns" when pruning removed instances.
    const [loadedWidgetIds, setLoadedWidgetIds] = useState<string[]>([]);
    const [editMode, setEditMode] = useState(false);
    const [isInitialized, setIsInitialized] = useState(false);
    const prevEditModeRef = useRef(editMode);
    const { t } = useLingui();
    const { i18n } = useLinguiRuntime();
    const [dateRange, setDateRange] = useState<DefinedDateRange>({
        from: startOfMonth(new Date()),
        to: endOfDay(new Date()),
    });
    // Session-only filter state seeded from each filter's defaultValue, shared with
    // widgets via WidgetFiltersProvider (useWidgetFilters().filters[id]).
    const widgetFilters = useMemo(() => getDashboardWidgetFilters(), []);
    const [filterValues, setFilterValues] = useState<Record<string, unknown>>(() =>
        Object.fromEntries(widgetFilters.map(filter => [filter.id, filter.defaultValue])),
    );

    const {
        settings,
        settingsReady,
        saveWidgetInstanceLayouts,
        setHiddenWidgets: persistHiddenWidgets,
        updateWidgetInstanceConfig,
    } = useUserSettings();
    const { hasPermissions } = usePermissions();

    // Polling is paused while editing so a background refetch can't disrupt a live edit.
    const { refresh, isRefreshing } = useInsightsRefresh({ enabled: !editMode });

    // Refs so the initializer/config-write handler read latest values without
    // becoming effect/callback dependencies (which would discard the unsaved draft).
    const settingsRef = useRef(settings);
    settingsRef.current = settings;
    const editModeRef = useRef(editMode);
    editModeRef.current = editMode;
    const widgetsRef = useRef(widgets);
    widgetsRef.current = widgets;

    // Deliberately not reactive to `settings.widgetInstances`: config is persisted immediately
    // via `updateWidgetInstanceConfig`, and rebuilding here on those writes would wipe out the
    // unsaved edit-mode draft. Also skipped while editing to avoid corrupting a live edit
    // session from an out-of-band settings change (e.g. synced from another tab).
    useEffect(() => {
        if (!settingsReady || editModeRef.current) {
            return;
        }
        const registered = getVisibleDashboardWidgets().filter(([, widget]) => {
            if (!widget.requiresPermissions || widget.requiresPermissions.length === 0) {
                return true;
            }
            return hasPermissions(widget.requiresPermissions);
        });
        const state = buildInitialWidgetState(settingsRef.current, registered);
        setWidgets(state.visible);
        setHiddenWidgets(state.hidden);
        setLoadedWidgetIds(state.loadedWidgetIds);
        setIsInitialized(true);
    }, [settingsReady, hasPermissions]);

    // Outside edit mode there's no Save step, so config is persisted right away (e.g. the
    // Metrics widget's Count/Total tab must survive a reload). While editing, it stays in
    // draft only and is committed together with the layout on "Save Layout".
    const handleConfigChange = useCallback(
        (instanceId: string, config: Record<string, unknown>) => {
            setWidgets(prev =>
                prev.map(widget => (widget.id === instanceId ? { ...widget, config } : widget)),
            );
            if (!editModeRef.current) {
                const target = widgetsRef.current.find(widget => widget.id === instanceId);
                if (target) {
                    updateWidgetInstanceConfig({
                        instanceId,
                        widgetId: target.widgetId,
                        layout: target.layout,
                        config,
                    });
                }
            }
        },
        [updateWidgetInstanceConfig],
    );

    // Save layout when edit mode is turned off
    useEffect(() => {
        // Only save when transitioning from edit mode ON to OFF
        if (prevEditModeRef.current && !editMode && isInitialized) {
            // Includes hidden widgets so a hidden single-instance widget keeps its
            // position/size when re-added, and commits draft config atomically with layout.
            const layouts = [...widgets, ...hiddenWidgets].map(widget => ({
                instanceId: widget.id,
                widgetId: widget.widgetId,
                layout: {
                    x: widget.layout.x,
                    y: widget.layout.y,
                    w: widget.layout.w,
                    h: widget.layout.h,
                },
                config: widget.config,
            }));
            saveWidgetInstanceLayouts(layouts, loadedWidgetIds);
            // A widget is hidden when it has no visible instance left (single-instance
            // hidden, or a multi-instance widget's last instance removed).
            const visibleWidgetIds = new Set(widgets.map(widget => widget.widgetId));
            persistHiddenWidgets(
                mergeHiddenWidgetIds(
                    settingsRef.current.hiddenWidgets ?? [],
                    loadedWidgetIds,
                    visibleWidgetIds,
                ),
            );
        }

        // Update the ref for next render
        prevEditModeRef.current = editMode;
    }, [
        editMode,
        isInitialized,
        widgets,
        hiddenWidgets,
        loadedWidgetIds,
        saveWidgetInstanceLayouts,
        persistHiddenWidgets,
    ]);

    const handleLayoutChange = (layouts: GridLayoutType[]) => {
        setWidgets(prev =>
            prev.map((widget, i) => ({
                ...widget,
                layout: layouts[i] || widget.layout,
            })),
        );
    };

    const handleRemoveWidget = (instanceId: string) => {
        const target = widgets.find(widget => widget.id === instanceId);
        if (!target) {
            return;
        }
        setWidgets(prev => {
            const remaining = prev.filter(widget => widget.id !== instanceId);
            return applyGridLayouts(remaining, compactLayouts(remaining.map(toGridLayout)));
        });
        // Single-instance widgets are kept hidden (with their layout) so re-adding restores
        // position/size; multi-instance widgets are re-added as fresh instances, so discard.
        const definition = getDashboardWidget(target.widgetId);
        if (!definition?.allowMultipleInstances) {
            setHiddenWidgets(prev => [...prev, target]);
        }
    };

    // Reflows any widgets now overlapping the restored widget's saved space, rather than
    // overlapping them or dumping it at the next free slot.
    const handleAddWidget = (instanceId: string) => {
        const target = hiddenWidgets.find(widget => widget.id === instanceId);
        if (!target) {
            return;
        }
        setHiddenWidgets(prev => prev.filter(widget => widget.id !== instanceId));
        setWidgets(prev => {
            const combined = [...prev, target];
            return applyGridLayouts(combined, insertWithReflow(prev.map(toGridLayout), toGridLayout(target)));
        });
    };

    const handleTidy = () => {
        setWidgets(prev => applyGridLayouts(prev, tidyLayouts(prev.map(toGridLayout))));
    };

    const handleAddWidgetInstance = (widgetId: string) => {
        const definition = getDashboardWidget(widgetId);
        if (!definition) {
            return;
        }
        setWidgets(prev => {
            const instance = buildWidgetInstance(definition, generateInstanceId(widgetId));
            const pos = findNextAvailablePosition({ ...toGridLayout(instance), y: 0 }, prev.map(toGridLayout));
            instance.layout.x = pos.x;
            instance.layout.y = pos.y;
            return [...prev, instance];
        });
    };

    const renderWidget = (widget: DashboardWidgetInstance) => {
        const definition = getDashboardWidget(widget.widgetId);
        if (!definition) return null;
        const WidgetComponent = definition.component;

        return (
            <div key={widget.id} className="relative h-full w-full">
                {editMode && (
                    <button
                        type="button"
                        aria-label={t`Remove widget`}
                        className="absolute -right-2 -top-2 z-20 flex h-6 w-6 items-center justify-center rounded-full border border-border bg-background text-muted-foreground shadow-sm hover:bg-muted hover:text-foreground"
                        onMouseDown={event => event.stopPropagation()}
                        onClick={() => handleRemoveWidget(widget.id)}
                    >
                        <XIcon className="h-3.5 w-3.5" />
                    </button>
                )}
                <WidgetInstanceProvider
                    value={{
                        instanceId: widget.id,
                        widgetId: widget.widgetId,
                        layout: {
                            x: widget.layout.x,
                            y: widget.layout.y,
                            w: widget.layout.w,
                            h: widget.layout.h,
                        },
                        config: widget.config,
                        setConfig: config => handleConfigChange(widget.id, config),
                    }}
                >
                    <WidgetComponent id={widget.id} config={widget.config} />
                </WidgetInstanceProvider>
            </div>
        );
    };

    // Always offered in the picker, even when already on the page, so more can be added.
    const multiInstanceWidgets = loadedWidgetIds
        .map(id => getDashboardWidget(id))
        .filter((definition): definition is DashboardWidgetDefinition => !!definition?.allowMultipleInstances);
    const hasPickerOptions = hiddenWidgets.length > 0 || multiInstanceWidgets.length > 0;

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
                {widgetFilters.map(filter => {
                    const FilterComponent = filter.component;
                    return (
                        <ActionBarItem key={filter.id} itemId={`widget-filter-${filter.id}`}>
                            <div className="mr-2">
                                <FilterComponent
                                    value={filterValues[filter.id]}
                                    onChange={value =>
                                        setFilterValues(prev => ({ ...prev, [filter.id]: value }))
                                    }
                                />
                            </div>
                        </ActionBarItem>
                    );
                })}
                {editMode && (
                    <ActionBarItem itemId="add-widget-picker">
                        <DropdownMenu>
                            <DropdownMenuTrigger render={<Button variant="outline" className="mr-2" />}>
                                <PlusIcon className="mr-1 h-4 w-4" />
                                <Trans>Add widget</Trans>
                            </DropdownMenuTrigger>
                            <DropdownMenuContent align="end">
                                {hasPickerOptions ? (
                                    <>
                                        {hiddenWidgets.map(widget => {
                                            const definition = getDashboardWidget(widget.widgetId);
                                            return (
                                                <DropdownMenuItem
                                                    key={widget.id}
                                                    onClick={() => handleAddWidget(widget.id)}
                                                >
                                                    {definition ? i18n.t(definition.name) : widget.widgetId}
                                                </DropdownMenuItem>
                                            );
                                        })}
                                        {multiInstanceWidgets.map(definition => (
                                            <DropdownMenuItem
                                                key={definition.id}
                                                onClick={() => handleAddWidgetInstance(definition.id)}
                                            >
                                                {i18n.t(definition.name)}
                                            </DropdownMenuItem>
                                        ))}
                                    </>
                                ) : (
                                    <DropdownMenuItem disabled>
                                        <Trans>No widgets to add</Trans>
                                    </DropdownMenuItem>
                                )}
                            </DropdownMenuContent>
                        </DropdownMenu>
                    </ActionBarItem>
                )}
                {editMode && (
                    <ActionBarItem itemId="tidy-widgets">
                        <Button
                            variant="outline"
                            className="mr-2"
                            disabled={widgets.length === 0}
                            onClick={handleTidy}
                        >
                            <Sparkles className="mr-1 h-4 w-4" />
                            <Trans>Tidy</Trans>
                        </Button>
                    </ActionBarItem>
                )}
                {!editMode && (
                    <ActionBarItem itemId="refresh-widgets">
                        <Button
                            variant="outline"
                            className="mr-2"
                            onClick={refresh}
                            disabled={isRefreshing}
                        >
                            <RefreshCw
                                className={isRefreshing ? 'animate-rotate mr-1 h-4 w-4' : 'mr-1 h-4 w-4'}
                            />
                            <Trans>Refresh</Trans>
                        </Button>
                    </ActionBarItem>
                )}
                <ActionBarItem itemId="edit-layout-button">
                    {editMode ? (
                        <Button variant="default" onClick={() => setEditMode(false)}>
                            <Trans>Save Layout</Trans>
                        </Button>
                    ) : (
                        <Tooltip>
                            <TooltipTrigger
                                render={
                                    <Button
                                        variant="outline"
                                        size="icon"
                                        aria-label={t`Edit layout`}
                                        onClick={() => setEditMode(true)}
                                    />
                                }
                            >
                                <SquarePen />
                            </TooltipTrigger>
                            <TooltipContent>
                                <Trans>Edit layout</Trans>
                            </TooltipContent>
                        </Tooltip>
                    )}
                </ActionBarItem>
            </PageActionBar>
            <PageLayout>
                <FullWidthPageBlock blockId="widgets">
                    <div className="w-full">
                        {!isInitialized ? null : widgets.length > 0 ? (
                            <WidgetFiltersProvider
                                filters={{ dateRange, filters: filterValues }}
                            >
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
                                className="flex items-center justify-center text-center text-muted-foreground"
                                style={{ height: '400px' }}
                            >
                                {editMode ? (
                                    <Trans>
                                        All widgets are hidden. Use the "Add widget" button to add them
                                        back.
                                    </Trans>
                                ) : (
                                    <Trans>No widgets to display. Use "Edit Layout" to add widgets.</Trans>
                                )}
                            </div>
                        )}
                    </div>
                </FullWidthPageBlock>
            </PageLayout>
        </Page>
    );
}
