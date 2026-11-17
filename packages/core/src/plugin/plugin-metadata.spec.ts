import { DynamicModule, Module } from '@nestjs/common';
import { describe, expect, it } from 'vitest';

import {
    flattenPlugins,
    getEntitiesFromPlugins,
    getModuleMetadata,
    getPluginAPIExtensions,
} from './plugin-metadata';
import { VendurePlugin } from './vendure-plugin';

describe('plugin metadata', () => {
    class FirstPlugin {}
    class SecondPlugin {}

    it('leaves a flat plugin list unchanged', () => {
        expect(flattenPlugins([FirstPlugin, SecondPlugin])).toEqual([FirstPlugin, SecondPlugin]);
    });

    it('flattens nested plugins depth-first in declared order', () => {
        @VendurePlugin({ plugins: [FirstPlugin, SecondPlugin] })
        class ChildCompositePlugin {}

        @VendurePlugin({ plugins: [ChildCompositePlugin] })
        class ParentCompositePlugin {}

        expect(flattenPlugins([ParentCompositePlugin])).toEqual([
            FirstPlugin,
            SecondPlugin,
            ChildCompositePlugin,
            ParentCompositePlugin,
        ]);
    });

    it('deduplicates plugins by class', () => {
        @VendurePlugin({ plugins: [FirstPlugin] })
        class CompositePlugin {}

        expect(flattenPlugins([CompositePlugin, FirstPlugin, CompositePlugin])).toEqual([
            FirstPlugin,
            CompositePlugin,
        ]);
    });

    it('handles DynamicModule entries and deduplicates them by module class', () => {
        const dynamicPlugin: DynamicModule = { module: FirstPlugin };

        expect(flattenPlugins([dynamicPlugin, FirstPlugin])).toEqual([dynamicPlugin]);
    });

    it('finds composed entities in a raw, unflattened plugin list', () => {
        class TestEntity {}

        @VendurePlugin({ entities: [TestEntity] })
        class EntityPlugin {}

        @VendurePlugin({ plugins: [EntityPlugin] })
        class CompositePlugin {}

        expect(getEntitiesFromPlugins([CompositePlugin])).toEqual([TestEntity]);
    });

    it('finds composed API extensions in a raw, unflattened plugin list', () => {
        const childExtension = { schema: undefined };
        const parentExtension = { schema: undefined };

        @VendurePlugin({ adminApiExtensions: childExtension })
        class ChildPlugin {}

        @VendurePlugin({ plugins: [{ module: ChildPlugin }], adminApiExtensions: parentExtension })
        class ParentPlugin {}

        for (const plugins of [[ParentPlugin], flattenPlugins([ParentPlugin])]) {
            const extensions = getPluginAPIExtensions(plugins, 'admin');
            expect(extensions).toHaveLength(2);
            expect(extensions[0]).toBe(childExtension);
            expect(extensions[1]).toBe(parentExtension);
        }
        expect(getPluginAPIExtensions([ParentPlugin], 'shop')).toEqual([]);
    });

    it('adds composed plugins to the NestJS module imports', () => {
        @Module({})
        class CommonModule {}

        @VendurePlugin({ imports: [CommonModule], plugins: [FirstPlugin, SecondPlugin] })
        class CompositePlugin {}

        expect(getModuleMetadata(CompositePlugin).imports).toEqual([CommonModule, FirstPlugin, SecondPlugin]);
    });
});
