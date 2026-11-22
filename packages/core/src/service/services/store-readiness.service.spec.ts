import { CurrencyCode, LanguageCode } from '@vendure/common/lib/generated-types';
import { describe, expect, it, vi } from 'vitest';

import { EntityNotFoundError, ForbiddenError } from '../../common/error/errors';
import { Logger } from '../../config/logger/vendure-logger';

import { StoreReadinessService } from './store-readiness.service';

const channel = {
    id: 1,
    code: 'default',
    defaultLanguageCode: LanguageCode.en,
    defaultCurrencyCode: CurrencyCode.USD,
    availableCurrencyCodes: [CurrencyCode.USD],
    defaultTaxZone: { id: 'z1' },
    defaultShippingZone: { id: 'z1' },
};

/**
 * A service whose collaborators report a ready store, except where a test overrides one. The
 * channel's variant count is zero, so the price, tax and search checks have nothing to compare.
 */
function build(overrides: Record<string, unknown> = {}) {
    const queryBuilder: any = new Proxy(
        {},
        {
            get: (_target, prop) => {
                if (prop === 'getCount') return () => Promise.resolve(0);
                if (prop === 'getRawMany') return () => Promise.resolve([]);
                if (prop === 'getOne') return () => Promise.resolve({ id: 'v1', passwordHash: 'hash' });
                return () => queryBuilder;
            },
        },
    );
    const deps: Record<string, any> = {
        connection: {
            getRepository: () => ({ createQueryBuilder: () => queryBuilder }),
            rawConnection: { hasMetadata: () => false },
        },
        configService: {
            authOptions: { superadminCredentials: { identifier: 'superadmin' } },
            paymentOptions: { paymentMethodHandlers: [] },
            taxOptions: { taxZoneStrategy: { determineTaxZone: () => undefined } },
        },
        channelService: {
            findAll: () => Promise.resolve({ items: [channel], totalItems: 1 }),
        },
        zoneService: { getAllWithMembers: () => Promise.resolve([]) },
        taxRateService: { findOverlappingZoneRates: () => Promise.resolve([]) },
        shippingMethodService: { findAll: () => Promise.resolve({ items: [], totalItems: 1 }) },
        paymentMethodService: { findAll: () => Promise.resolve({ items: [], totalItems: 1 }) },
        stockLocationService: { findAll: () => Promise.resolve({ items: [], totalItems: 1 }) },
        orderTestingService: { testEligibleShippingMethods: () => Promise.resolve([{ id: 'm1' }]) },
        requestContextService: { create: vi.fn(() => Promise.resolve({ channelId: 1 })) },
        roleService: { userHasPermissionOnChannel: vi.fn(() => Promise.resolve(true)) },
        passwordCipher: { check: () => Promise.resolve(false) },
        ...overrides,
    };
    const service = new StoreReadinessService(
        deps.connection,
        deps.configService,
        deps.channelService,
        deps.zoneService,
        deps.taxRateService,
        deps.shippingMethodService,
        deps.paymentMethodService,
        deps.stockLocationService,
        deps.orderTestingService,
        deps.requestContextService,
        deps.roleService,
        deps.passwordCipher,
    );
    return { service, deps };
}

describe('StoreReadinessService', () => {
    it('reports a store with no gaps as ready', async () => {
        const { service, deps } = build();
        expect(await service.check({} as any)).toEqual({ ready: true, findings: [] });
        expect(deps.requestContextService.create).toHaveBeenCalledWith(
            expect.objectContaining({ channelOrToken: channel, currencyCode: CurrencyCode.USD }),
        );
    });

    it('turns a check that throws into a finding and still runs the other checks', async () => {
        const errorSpy = vi.spyOn(Logger, 'error').mockImplementation(() => undefined);
        try {
            const { service } = build({
                paymentMethodService: { findAll: () => Promise.reject(new Error('database is down')) },
                stockLocationService: { findAll: () => Promise.resolve({ items: [], totalItems: 0 }) },
            });
            const report = await service.check({} as any);
            expect(report.ready).toBe(false);
            expect(report.findings.map(f => f.code)).toEqual([
                'store.check.failed',
                'store.channel.no-stock-location',
            ]);
            expect(report.findings[0].message).toContain('payment-methods');
            expect(report.findings[0].message).toContain('database is down');
        } finally {
            errorSpy.mockRestore();
        }
    });

    it('skips channels the caller may not read, and refuses them when asked for by ID', async () => {
        const denied = build({ roleService: { userHasPermissionOnChannel: () => Promise.resolve(false) } });
        expect(await denied.service.check({} as any)).toEqual({ ready: true, findings: [] });
        expect(denied.deps.requestContextService.create).not.toHaveBeenCalled();

        // A channel asked for by ID is refused rather than skipped, so the report never looks ready
        // for a channel it did not check.
        await expect(denied.service.check({} as any, { channelIds: [1] })).rejects.toThrow(ForbiddenError);
        await expect(build().service.check({} as any, { channelIds: [2] })).rejects.toThrow(
            EntityNotFoundError,
        );

        const asked = build();
        await asked.service.check({} as any, { channelIds: [1] });
        expect(asked.deps.requestContextService.create).toHaveBeenCalled();
    });

    it('is ready with warnings only', async () => {
        const { service } = build({ passwordCipher: { check: () => Promise.resolve(true) } });
        const report = await service.check({} as any);
        expect(report.ready).toBe(true);
        expect(report.findings.map(f => f.severity)).toEqual(['warning']);
    });
});
