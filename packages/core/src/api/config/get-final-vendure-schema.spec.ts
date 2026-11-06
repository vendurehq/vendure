import { DynamicModule } from '@nestjs/common';
import { GraphQLTypesLoader } from '@nestjs/graphql';
import { Type } from '@vendure/common/lib/shared-types';
import gql from 'graphql-tag';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { runPluginConfigurations } from '../../bootstrap';
import { getConfig, resetConfig, setConfig } from '../../config/config-helpers';
import { flattenPlugins } from '../../plugin/plugin-metadata';
import { VendurePlugin } from '../../plugin/vendure-plugin';
import { VENDURE_ADMIN_API_TYPE_PATHS } from '../constants';

import { getFinalVendureSchema } from './get-final-vendure-schema';

// `get-final-vendure-schema.ts` imports from 'graphql/index', which Vitest loads as a separate
// module instance from 'graphql'. Use one instance so that schema objects can pass between them.
vi.mock('graphql/index', async () => await import('graphql/index.js'));

@VendurePlugin({
    adminApiExtensions: {
        schema: gql`
            type ComposedChildType {
                id: ID!
            }
            extend type Query {
                composedChild: ComposedChildType
            }
        `,
    },
    configuration: config => {
        config.customFields.Product.push({ name: 'composedChildField', type: 'string' });
        return config;
    },
})
class ChildPlugin {}

@VendurePlugin({
    plugins: [ChildPlugin],
    adminApiExtensions: {
        schema: gql`
            extend type ComposedChildType {
                parentField: String
            }
        `,
    },
})
class ParentPlugin {}

@VendurePlugin({ plugins: [{ module: ParentPlugin }] })
class GrandparentPlugin {}

/**
 * Builds the Admin API schema the same way as the CLI and Dashboard schema generators:
 * without `preBootstrapConfig`, so the plugin list is not flattened before this call.
 */
async function generateAdminSchema(plugins: Array<Type<any> | DynamicModule>): Promise<string> {
    await setConfig({ plugins });
    const config = await runPluginConfigurations(getConfig() as any);
    return getFinalVendureSchema({
        config,
        typePaths: VENDURE_ADMIN_API_TYPE_PATHS,
        typesLoader: new GraphQLTypesLoader(),
        apiType: 'admin',
        output: 'sdl',
    });
}

describe('getFinalVendureSchema() with composed plugins', () => {
    afterEach(() => {
        resetConfig();
    });

    it('includes the API extensions and configuration of composed plugins', async () => {
        const schema = await generateAdminSchema([ParentPlugin]);

        expect(schema).toContain('composedChild: ComposedChildType');
        expect(schema).toMatch(/type ComposedChildType \{[^}]*parentField: String/);
        expect(schema).toContain('composedChildField: String');
    });

    it('includes plugins composed through nested DynamicModule entries', async () => {
        const schema = await generateAdminSchema([{ module: GrandparentPlugin }]);

        expect(schema).toMatch(/type ComposedChildType \{[^}]*parentField: String/);
        expect(schema).toContain('composedChildField: String');
    });

    it('gives the same schema when the plugin list is already flattened', async () => {
        const fromRaw = await generateAdminSchema([ParentPlugin]);
        resetConfig();
        const fromFlattened = await generateAdminSchema(flattenPlugins([ParentPlugin]));

        expect(fromFlattened).toEqual(fromRaw);
    });
});
