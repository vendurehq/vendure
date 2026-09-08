import type { DashboardWidgetDefinition } from '@/vdb/framework/extension-api/types/widgets.js';
import type { PersistedWidgetInstance, UserSettings } from '@/vdb/providers/user-settings.js';
import { describe, expect, it } from 'vitest';

import { buildInitialWidgetState, mergeHiddenWidgetIds } from './insights-layout.js';

const def = (id: string, overrides: Partial<DashboardWidgetDefinition> = {}): DashboardWidgetDefinition =>
    ({
        id,
        name: id,
        component: (() => null) as any,
        defaultSize: { w: 4, h: 3 },
        ...overrides,
    }) as DashboardWidgetDefinition;

const settings = (
    overrides: Partial<Pick<UserSettings, 'widgetInstances' | 'widgetLayout' | 'hiddenWidgets'>> = {},
): Pick<UserSettings, 'widgetInstances' | 'widgetLayout' | 'hiddenWidgets'> => ({
    widgetInstances: [],
    widgetLayout: {},
    hiddenWidgets: [],
    ...overrides,
});

const instance = (
    instanceId: string,
    widgetId: string,
    layout: PersistedWidgetInstance['layout'],
    config?: Record<string, unknown>,
): PersistedWidgetInstance => ({ instanceId, widgetId, layout, config });

describe('buildInitialWidgetState', () => {
    it('restores a persisted single instance at its saved layout and config', () => {
        const widget = def('metrics');
        const state = buildInitialWidgetState(
            settings({
                widgetInstances: [
                    instance('metrics', 'metrics', { x: 2, y: 1, w: 6, h: 4 }, { dataType: 'total' }),
                ],
            }),
            [['metrics', widget]],
        );

        expect(state.visible).toHaveLength(1);
        expect(state.hidden).toHaveLength(0);
        expect(state.visible[0]).toMatchObject({
            id: 'metrics',
            widgetId: 'metrics',
            config: { dataType: 'total' },
        });
        expect(state.visible[0].layout).toMatchObject({ x: 2, y: 1, w: 6, h: 4 });
        expect(state.loadedWidgetIds).toEqual(['metrics']);
    });

    it('restores every persisted instance of a multi-instance widget independently', () => {
        const note = def('note', { allowMultipleInstances: true });
        const state = buildInitialWidgetState(
            settings({
                widgetInstances: [
                    instance('note:a', 'note', { x: 0, y: 0, w: 4, h: 3 }, { tone: 'neutral' }),
                    instance('note:b', 'note', { x: 4, y: 0, w: 4, h: 3 }, { tone: 'accent' }),
                ],
            }),
            [['note', note]],
        );

        expect(state.visible.map(w => w.id)).toEqual(['note:a', 'note:b']);
        expect(state.visible.map(w => w.config)).toEqual([{ tone: 'neutral' }, { tone: 'accent' }]);
    });

    it('only reconstructs persisted instances, not extra draft-only ones', () => {
        // Draft-only instances have no persisted entry, so a rebuild would drop them.
        const note = def('note', { allowMultipleInstances: true });
        const state = buildInitialWidgetState(
            settings({
                widgetInstances: [
                    instance('note:saved', 'note', { x: 0, y: 0, w: 4, h: 3 }, { tone: 'accent' }),
                ],
            }),
            [['note', note]],
        );

        expect(state.visible.map(w => w.id)).toEqual(['note:saved']);
        expect(state.loadedWidgetIds).toEqual(['note']);
    });

    it('puts persisted instances of hidden widgets into the hidden list', () => {
        const widget = def('metrics');
        const state = buildInitialWidgetState(
            settings({
                widgetInstances: [instance('metrics', 'metrics', { x: 0, y: 0, w: 4, h: 3 })],
                hiddenWidgets: ['metrics'],
            }),
            [['metrics', widget]],
        );

        expect(state.visible).toHaveLength(0);
        expect(state.hidden.map(w => w.id)).toEqual(['metrics']);
    });

    it('keeps a restorable default for a hidden single-instance widget with no persisted instance', () => {
        const single = def('single');
        const multi = def('multi', { allowMultipleInstances: true });
        const state = buildInitialWidgetState(settings({ hiddenWidgets: ['single', 'multi'] }), [
            ['single', single],
            ['multi', multi],
        ]);

        // Single-instance hidden widgets keep a default instance so re-adding restores them.
        expect(state.hidden.map(w => w.widgetId)).toEqual(['single']);
        // Multi-instance hidden widgets carry no default and are re-added fresh from the picker.
        expect(state.visible).toHaveLength(0);
    });

    it('migrates a legacy widgetLayout entry when no persisted instance exists', () => {
        const widget = def('metrics');
        const state = buildInitialWidgetState(
            settings({ widgetLayout: { metrics: { x: 3, y: 2, w: 5, h: 2 } } }),
            [['metrics', widget]],
        );

        expect(state.visible[0].layout).toMatchObject({ x: 3, y: 2, w: 5, h: 2 });
    });

    it('places a fresh default-visible widget at the first free slot (no overlaps)', () => {
        const a = def('a', { defaultSize: { w: 6, h: 3 } });
        const b = def('b', { defaultSize: { w: 6, h: 3 } });
        const state = buildInitialWidgetState(settings(), [
            ['a', a],
            ['b', b],
        ]);

        expect(state.visible).toHaveLength(2);
        const [first, second] = state.visible;
        // Second widget fits alongside the first on the 12-col grid rather than overlapping.
        expect(first.layout).toMatchObject({ x: 0, y: 0 });
        expect(second.layout).toMatchObject({ x: 6, y: 0 });
    });

    it('ignores persisted instances for widgets that are not registered', () => {
        const widget = def('metrics');
        const state = buildInitialWidgetState(
            settings({
                widgetInstances: [
                    instance('metrics', 'metrics', { x: 0, y: 0, w: 4, h: 3 }),
                    instance('gone', 'gone', { x: 0, y: 0, w: 4, h: 3 }),
                ],
            }),
            [['metrics', widget]],
        );

        expect(state.visible.map(w => w.widgetId)).toEqual(['metrics']);
        expect(state.loadedWidgetIds).toEqual(['metrics']);
    });
});

describe('mergeHiddenWidgetIds', () => {
    it('preserves hidden widgets that are unavailable in the active channel', () => {
        expect(mergeHiddenWidgetIds(['orders', 'catalog'], ['orders'], ['orders'])).toEqual(['catalog']);
    });

    it('updates the hidden state only for widgets loaded by the active channel', () => {
        expect(mergeHiddenWidgetIds(['orders', 'catalog'], ['orders', 'customers'], ['customers'])).toEqual([
            'catalog',
            'orders',
        ]);
    });
});
