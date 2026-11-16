import type { ConfigService, CustomFieldConfig, Injector, RequestContext } from '@vendure/core';
import { describe, expect, it } from 'vitest';

import { assertCustomFieldsWritable } from './custom-field-input';

/** Address custom fields for the tests: writable, internal, admin-only, and read-only. */
const addressCustomFields: CustomFieldConfig[] = [
    { name: 'deliveryNote', type: 'string' },
    { name: 'internalRef', type: 'string', internal: true },
    { name: 'riskScore', type: 'int', public: false },
    { name: 'lockedCode', type: 'string', readonly: true },
];

// Core's validator also receives this Injector, but resolves nothing from it for these field types.
function injectorFor(customFields: CustomFieldConfig[]): Injector {
    const configService = { customFields: { Address: customFields } } as unknown as ConfigService;
    return { get: () => configService } as unknown as Injector;
}

function ctxFor(apiType: 'admin' | 'shop'): RequestContext {
    return { apiType } as RequestContext;
}

describe('assertCustomFieldsWritable', () => {
    const injector = injectorFor(addressCustomFields);
    const assertWritable = (ctx: RequestContext, input: Record<string, unknown> | undefined) =>
        assertCustomFieldsWritable(ctx, injector, 'Address', input);

    it('passes a plain writable field through', async () => {
        await expect(
            assertWritable(ctxFor('shop'), { deliveryNote: 'Leave at the door' }),
        ).resolves.toBeUndefined();
    });

    it('does nothing when the tool was given no custom fields', async () => {
        await expect(assertWritable(ctxFor('shop'), undefined)).resolves.toBeUndefined();
    });

    it('refuses a key that is not a configured custom field', async () => {
        await expect(assertWritable(ctxFor('admin'), { notAField: 'x' })).rejects.toThrow(
            'These custom fields cannot be set on Address: notAField.',
        );
    });

    it('refuses an internal field, whatever the caller is', async () => {
        await expect(assertWritable(ctxFor('admin'), { internalRef: 'x' })).rejects.toThrow(/internalRef/);
        await expect(assertWritable(ctxFor('shop'), { internalRef: 'x' })).rejects.toThrow(/internalRef/);
    });

    it('refuses a non-public field for a shop caller but accepts it from an admin caller', async () => {
        await expect(assertWritable(ctxFor('shop'), { riskScore: 3 })).rejects.toThrow(/riskScore/);
        await expect(assertWritable(ctxFor('admin'), { riskScore: 3 })).resolves.toBeUndefined();
    });

    it('names every refused key in one error', async () => {
        await expect(
            assertWritable(ctxFor('shop'), { internalRef: 'x', riskScore: 3, deliveryNote: 'fine' }),
        ).rejects.toThrow(/internalRef, riskScore/);
    });

    it("lets core's validator refuse a readonly field", async () => {
        // Core's message is a translation key, which tells its refusal apart from this function's.
        await expect(assertWritable(ctxFor('admin'), { lockedCode: 'x' })).rejects.toThrow(
            /error.field-invalid-readonly/,
        );
    });

    it('matches a relation custom field by the name the input uses', async () => {
        const relationInjector = injectorFor([
            { name: 'pickupPoint', type: 'relation', entity: {} as any },
        ] as CustomFieldConfig[]);
        await expect(
            assertCustomFieldsWritable(ctxFor('admin'), relationInjector, 'Address', { pickupPointId: 1 }),
        ).resolves.toBeUndefined();
        await expect(
            assertCustomFieldsWritable(ctxFor('admin'), relationInjector, 'Address', { pickupPoint: 1 }),
        ).rejects.toThrow(/pickupPoint/);
    });
});
