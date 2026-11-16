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

    it('preserves explicit defaultSize.x when the position is unobstructed', () => {
        const widget = def('orders-summary', { defaultSize: { w: 6, h: 3, x: 6, y: 0 } });
        const state = buildInitialWidgetState(settings(), [['orders-summary', widget]]);
        expect(state.visible[0].layout).toMatchObject({ x: 6, y: 0 });
    });

    it('falls back to findNextAvailablePosition when defaultSize.x/y conflicts with a placed widget', () => {
        const a = def('a', { defaultSize: { w: 6, h: 3, x: 0, y: 0 } });
        const b = def('b', { defaultSize: { w: 6, h: 3, x: 0, y: 0 } });
        const state = buildInitialWidgetState(settings(), [
            ['a', a],
            ['b', b],
        ]);
        expect(state.visible[0].layout).toMatchObject({ x: 0, y: 0 });
        expect(state.visible[1].layout).toMatchObject({ x: 6, y: 0 });
    });

    it('falls back when defaultSize.x equals the column count (widget would start outside grid)', () => {
        // Columns are 0-indexed, so x: 12 starts outside a 12-column grid.
        const widget = def('w', { defaultSize: { w: 4, h: 3, x: 12, y: 0 } });
        const state = buildInitialWidgetState(settings(), [['w', widget]]);
        expect(state.visible[0].layout).toMatchObject({ x: 0, y: 0 });
    });

    it('falls back when defaultSize x + w exceeds the column count', () => {
        // x: 10, w: 4 → occupies columns 10–13, which overflows a 12-col grid.
        const widget = def('w', { defaultSize: { w: 4, h: 3, x: 10, y: 0 } });
        const state = buildInitialWidgetState(settings(), [['w', widget]]);
        expect(state.visible[0].layout).toMatchObject({ x: 0, y: 0 });
    });

    it('uses the fallback for a new widget when the layout already has saved entries', () => {
        // widgetInstances is set, so the default position is ignored and 'b' goes to the
        // first free slot after 'a' instead of y: 13.
        const a = def('a', { defaultSize: { w: 12, h: 6, x: 0, y: 0 } });
        const b = def('b', { defaultSize: { w: 6, h: 3, x: 0, y: 13 } });
        const state = buildInitialWidgetState(
            settings({
                widgetInstances: [instance('a', 'a', { x: 0, y: 0, w: 12, h: 6 })],
            }),
            [
                ['a', a],
                ['b', b],
            ],
        );
        expect(state.visible).toHaveLength(2);
        expect(state.visible[0].layout).toMatchObject({ x: 0, y: 0, w: 12, h: 6 });
        // Fallback fires: first free slot is (0, 6), not the hint (0, 13).
        expect(state.visible[1].layout).toMatchObject({ x: 0, y: 6 });
    });

    // #5616: the default positions assume the full widget set, so a permission-filtered set packs from the top
    it('uses the fallback on a fresh layout when some widgets were filtered out by permissions', () => {
        const latestCustomers = def('latest-customers', { defaultSize: { w: 4, h: 6, x: 8, y: 13 } });
        const state = buildInitialWidgetState(settings(), [['latest-customers', latestCustomers]], {
            someWidgetsFiltered: true,
        });

        expect(state.visible[0].layout).toMatchObject({ x: 0, y: 0 });
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
