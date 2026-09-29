import { ModuleRef } from '@nestjs/core';
import { ConfigService, CustomFieldConfig, RequestContext } from '@vendure/core';
import { describe, expect, it } from 'vitest';

import { McpCustomFieldInputService } from './custom-field-input.service';

/** Address custom fields for the tests: writable, internal, admin-only, and read-only. */
const addressCustomFields: CustomFieldConfig[] = [
    { name: 'deliveryNote', type: 'string' },
    { name: 'internalRef', type: 'string', internal: true },
    { name: 'riskScore', type: 'int', public: false },
    { name: 'lockedCode', type: 'string', readonly: true },
];

function serviceFor(customFields: CustomFieldConfig[]): McpCustomFieldInputService {
    const configService = { customFields: { Address: customFields } } as unknown as ConfigService;
    // Core's validator needs an Injector but resolves nothing for these field types.
    const moduleRef = {} as ModuleRef;
    return new McpCustomFieldInputService(configService, moduleRef);
}

function ctxFor(apiType: 'admin' | 'shop'): RequestContext {
    return { apiType } as RequestContext;
}

describe('McpCustomFieldInputService', () => {
    const service = serviceFor(addressCustomFields);

    it('passes a plain writable field through', async () => {
        await expect(
            service.assertWritable(ctxFor('shop'), 'Address', { deliveryNote: 'Leave at the door' }),
        ).resolves.toBeUndefined();
    });

    it('does nothing when the tool was given no custom fields', async () => {
        await expect(service.assertWritable(ctxFor('shop'), 'Address', undefined)).resolves.toBeUndefined();
    });

    it('refuses a key that is not a configured custom field', async () => {
        await expect(service.assertWritable(ctxFor('admin'), 'Address', { notAField: 'x' })).rejects.toThrow(
            /notAField/,
        );
    });

    it('refuses an internal field, whatever the caller is', async () => {
        await expect(
            service.assertWritable(ctxFor('admin'), 'Address', { internalRef: 'x' }),
        ).rejects.toThrow(/internalRef/);
        await expect(service.assertWritable(ctxFor('shop'), 'Address', { internalRef: 'x' })).rejects.toThrow(
            /internalRef/,
        );
    });

    it('refuses a non-public field for a shop caller but accepts it from an admin caller', async () => {
        await expect(service.assertWritable(ctxFor('shop'), 'Address', { riskScore: 3 })).rejects.toThrow(
            /riskScore/,
        );
        await expect(
            service.assertWritable(ctxFor('admin'), 'Address', { riskScore: 3 }),
        ).resolves.toBeUndefined();
    });

    it('names every refused key in one error', async () => {
        await expect(
            service.assertWritable(ctxFor('shop'), 'Address', {
                internalRef: 'x',
                riskScore: 3,
                deliveryNote: 'fine',
            }),
        ).rejects.toThrow(/internalRef, riskScore/);
    });

    it("lets core's validator refuse a readonly field", async () => {
        // Core's message is a translation key, which tells its refusal apart from the plugin's.
        await expect(service.assertWritable(ctxFor('admin'), 'Address', { lockedCode: 'x' })).rejects.toThrow(
            /error.field-invalid-readonly/,
        );
    });

    it('matches a relation custom field by the name the input uses', async () => {
        const relationService = serviceFor([
            { name: 'pickupPoint', type: 'relation', entity: {} as any },
        ] as CustomFieldConfig[]);
        await expect(
            relationService.assertWritable(ctxFor('admin'), 'Address', { pickupPointId: 1 }),
        ).resolves.toBeUndefined();
        await expect(
            relationService.assertWritable(ctxFor('admin'), 'Address', { pickupPoint: 1 }),
        ).rejects.toThrow(/pickupPoint/);
    });
});
