import { Permission } from '@vendure/common/lib/generated-types';
import { GraphQLResolveInfo } from 'graphql';
import { describe, expect, it } from 'vitest';

import { ConfigService } from '../../../config/config.service';
import { CustomFields } from '../../../config/custom-field/custom-field-types';
import { ChannelService } from '../../../service/services/channel.service';
import { GlobalSettingsService } from '../../../service/services/global-settings.service';
import { OrderService } from '../../../service/services/order.service';
import { RequestContext } from '../../common/request-context';

import { GlobalSettingsResolver } from './global-settings.resolver';

// #5442 — the Dashboard needs defaults, but config metadata must not bypass field access rules.
describe('GlobalSettingsResolver custom field defaults', () => {
    const customFields: CustomFields = {
        Product: [
            { name: 'warrantyMonths', type: 'int', nullable: false, defaultValue: 12 },
            { name: 'zero', type: 'int', defaultValue: 0 },
            { name: 'disabled', type: 'boolean', defaultValue: false },
            { name: 'apiKey', type: 'string', secret: true, defaultValue: 'secret' },
            {
                name: 'related',
                type: 'relation',
                entity: class RelatedEntity {} as any,
                defaultValue: { privateNotes: 'not config metadata' },
            },
            {
                name: 'restricted',
                type: 'string',
                defaultValue: 'restricted-default',
                requiresPermission: [Permission.ReadProduct, Permission.UpdateProduct],
            },
            { name: 'internal', type: 'string', internal: true, defaultValue: 'internal-default' },
        ],
    };

    function getConfig(permissions: Permission[] = []) {
        const resolver = new GlobalSettingsResolver(
            {
                customFields,
                authOptions: { customPermissions: [] },
                assetOptions: { permittedFileTypes: [] },
                entityOptions: { moneyStrategy: { precision: 2 } },
            } as unknown as ConfigService,
            {} as GlobalSettingsService,
            {} as ChannelService,
            { getOrderProcessStates: () => [] } as unknown as OrderService,
        );
        const ctx = {
            apiType: 'admin',
            userHasPermissions: (required: Permission[]) =>
                permissions.includes(Permission.SuperAdmin) || required.some(p => permissions.includes(p)),
        } as RequestContext;
        return resolver.serverConfig(ctx, {
            schema: { getType: () => undefined },
        } as unknown as GraphQLResolveInfo);
    }

    it('returns configured defaults including falsy values through both config APIs', () => {
        const result = getConfig();
        const expected = { warrantyMonths: 12, zero: 0, disabled: false };
        for (const fields of [result.customFieldConfig.Product, result.entityCustomFields[0].customFields]) {
            for (const [name, value] of Object.entries(expected)) {
                expect(fields?.find(field => field.name === name)?.defaultValue).toEqual(value);
            }
            expect(fields?.some(field => field.name === 'internal')).toBe(false);
            expect(fields?.find(field => field.name === 'related')?.defaultValue).toBeUndefined();
        }
    });

    it('never exposes secret defaults, even to a superadmin', () => {
        const result = getConfig([Permission.SuperAdmin]);
        for (const fields of [result.customFieldConfig.Product, result.entityCustomFields[0].customFields]) {
            expect(fields?.find(field => field.name === 'apiKey')?.defaultValue).toBeUndefined();
        }
        expect(customFields.Product?.find(field => field.name === 'apiKey')?.defaultValue).toBe('secret');
    });

    it('respects custom-field permissions', () => {
        for (const permissions of [[], [Permission.ReadProduct]]) {
            const result = getConfig(permissions);
            for (const fields of [
                result.customFieldConfig.Product,
                result.entityCustomFields[0].customFields,
            ]) {
                expect(fields?.find(field => field.name === 'restricted')?.defaultValue).toBe(
                    permissions.length ? 'restricted-default' : undefined,
                );
            }
        }
    });
});
