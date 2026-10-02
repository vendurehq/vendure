import { DeepPartial } from '@vendure/common/lib/shared-types';
import { Column, Entity } from 'typeorm';
import { describe, expect, it } from 'vitest';

import { preBootstrapConfig } from './bootstrap';
import { HasCustomFields } from './config/custom-field/custom-field-types';
import { VendureEntity } from './entity/base/base.entity';
import { VendurePlugin } from './plugin/vendure-plugin';

class PluginEntityCustomFields {}

@Entity()
class PluginEntityWithCustomFields extends VendureEntity implements HasCustomFields {
    constructor(input?: DeepPartial<PluginEntityWithCustomFields>) {
        super(input);
    }

    @Column(() => PluginEntityCustomFields)
    customFields: PluginEntityCustomFields;
}

@VendurePlugin({
    entities: [PluginEntityWithCustomFields],
    configuration: config => {
        config.customFields.PluginEntityWithCustomFields.push({ name: 'foo', type: 'string' });
        return config;
    },
})
class PluginWithCustomFieldsOnOwnEntity {}

class OtherPluginEntityCustomFields {}

@Entity()
class OtherPluginEntityWithCustomFields extends VendureEntity implements HasCustomFields {
    constructor(input?: DeepPartial<OtherPluginEntityWithCustomFields>) {
        super(input);
    }

    @Column(() => OtherPluginEntityCustomFields)
    customFields: OtherPluginEntityCustomFields;
}

@VendurePlugin({ entities: [OtherPluginEntityWithCustomFields] })
class PluginWithoutCustomFieldsConfig {}

describe('preBootstrapConfig()', () => {
    // #3274 — a plugin entity implementing HasCustomFields should have a customFields array
    // available to plugin configuration functions
    it('initializes custom fields config for plugin entities with a customFields property', async () => {
        const config = await preBootstrapConfig({
            dbConnectionOptions: { type: 'sqljs' },
            plugins: [PluginWithCustomFieldsOnOwnEntity],
        });

        expect(config.customFields.PluginEntityWithCustomFields).toEqual([
            { name: 'foo', type: 'string' },
        ]);
    });

    it('does not leave an empty custom fields config for plugin entities when none are added', async () => {
        const config = await preBootstrapConfig({
            dbConnectionOptions: { type: 'sqljs' },
            plugins: [PluginWithoutCustomFieldsConfig],
        });

        expect(Object.keys(config.customFields)).not.toContain('OtherPluginEntityWithCustomFields');
    });
});
