import { createContext, PropsWithChildren } from 'react';

/**
 * @description
 * The identity and layout of the Insights widget instance currently being rendered.
 * Provided per widget instance on the Insights page so that hooks such as
 * `useWidgetConfig` can resolve and persist per-instance state.
 */
export interface WidgetInstanceContextValue {
    instanceId: string;
    widgetId: string;
    layout: { x: number; y: number; w: number; h: number };
    /**
     * The instance's current (draft) config overrides, seeded from persisted settings on
     * load. `useWidgetConfig` merges this over the widget definition's `defaultConfig`.
     */
    config?: Record<string, unknown>;
    /**
     * Persists a full config object for this instance. The Insights page owns the write
     * target: outside edit mode the config is persisted to user settings immediately;
     * while editing it is held in draft state and committed on "Save Layout", so a config
     * change never turns a never-saved draft instance into a permanent one.
     */
    setConfig: (config: Record<string, unknown>) => void;
}

export const WidgetInstanceContext = createContext<WidgetInstanceContextValue | undefined>(undefined);

export function WidgetInstanceProvider({
    children,
    value,
}: PropsWithChildren<{ value: WidgetInstanceContextValue }>) {
    return <WidgetInstanceContext.Provider value={value}>{children}</WidgetInstanceContext.Provider>;
}
