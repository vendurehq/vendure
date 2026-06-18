import { CurrencyCode, LanguageCode, Permission } from '@vendure/common/lib/generated-types';
import { beforeAll, describe, expect, it } from 'vitest';

import { CachedSession } from '../../config/session-cache/session-cache-strategy';
import { Channel } from '../../entity/channel/channel.entity';
import { Order } from '../../entity/order/order.entity';
import { Zone } from '../../entity/zone/zone.entity';

import { RequestContext, SerializedRequestContext } from './request-context';

describe('RequestContext', () => {
    describe('serialize/deserialize', () => {
        let serializedCtx: SerializedRequestContext;
        let original: RequestContext;

        beforeAll(() => {
            original = createRequestContext();
            serializedCtx = original.serialize();
        });

        it('apiType', () => {
            const result = RequestContext.deserialize(serializedCtx);
            expect(result.apiType).toBe(original.apiType);
        });

        it('channelId', () => {
            const result = RequestContext.deserialize(serializedCtx);
            expect(result.channelId).toBe(original.channelId);
        });

        it('languageCode', () => {
            const result = RequestContext.deserialize(serializedCtx);
            expect(result.languageCode).toBe(original.languageCode);
        });

        it('activeUserId', () => {
            const result = RequestContext.deserialize(serializedCtx);
            expect(result.activeUserId).toBe(original.activeUserId);
        });

        it('isAuthorized', () => {
            const result = RequestContext.deserialize(serializedCtx);
            expect(result.isAuthorized).toBe(original.isAuthorized);
        });

        it('authorizedAsOwnerOnly', () => {
            const result = RequestContext.deserialize(serializedCtx);
            expect(result.authorizedAsOwnerOnly).toBe(original.authorizedAsOwnerOnly);
        });

        it('channel', () => {
            const result = RequestContext.deserialize(serializedCtx);
            expect(result.channel).toEqual(original.channel);
        });

        it('session', () => {
            const result = RequestContext.deserialize(serializedCtx);
            expect(result.session).toEqual(original.session);
        });

        // https://github.com/vendurehq/vendure/issues/864
        it('serialize request context with circular refs', () => {
            const cyclic: any = {};
            const cyclic1: any = {
                prop: cyclic,
            };
            cyclic.prop = cyclic1;

            const requestContext = createRequestContext({
                simple: 'foo',
                arr: [1, 2, 3],
                cycle: cyclic,
                cycleArr: [cyclic, cyclic],
            });

            const serialized = requestContext.serialize();
            expect(serialized._req).toEqual({
                simple: 'foo',
                arr: [1, 2, 3],
                cycle: {},
                cycleArr: [{}, {}],
            });
        });
    });

    describe('copy', () => {
        let original: RequestContext;

        beforeAll(() => {
            original = createRequestContext();
        });

        it('is a RequestContext instance', () => {
            const copy = original.copy();
            expect(copy instanceof RequestContext).toBe(true);
        });

        it('is not identical to original', () => {
            const copy = original.copy();
            expect(copy === original).toBe(false);
        });

        it('getters work', () => {
            const copy = original.copy();

            expect(copy.apiType).toEqual(original.apiType);
            expect(copy.channelId).toEqual(original.channelId);
            expect(copy.languageCode).toEqual(original.languageCode);
            expect(copy.activeUserId).toEqual(original.activeUserId);
            expect(copy.isAuthorized).toEqual(original.isAuthorized);
            expect(copy.authorizedAsOwnerOnly).toEqual(original.authorizedAsOwnerOnly);
            expect(copy.channel).toEqual(original.channel);
            expect(copy.session).toEqual(original.session);
        });

        it('mutating copy leaves original intact', () => {
            const copy = original.copy();
            (copy as any).foo = 'bar';

            expect((copy as any).foo).toBe('bar');
            expect((original as any).foo).toBeUndefined();
        });

        it('mutating deep property affects both', () => {
            const copy = original.copy();
            copy.channel.code = 'changed';

            expect(copy.channel.code).toBe('changed');
            expect(original.channel.code).toBe('changed');
        });
    });

    describe('userHasPermissions', () => {
        it('returns false when no session', () => {
            const ctx = createRequestContextWithPermissions([], false);
            expect(ctx.userHasPermissions([Permission.ReadProduct])).toBe(false);
        });

        it('returns false when user has no permissions on channel', () => {
            const ctx = createRequestContextWithPermissions([]);
            expect(ctx.userHasPermissions([Permission.ReadProduct])).toBe(false);
        });

        it('returns true if user has ANY of the permissions (OR logic)', () => {
            const ctx = createRequestContextWithPermissions([Permission.ReadProduct]);
            expect(ctx.userHasPermissions([Permission.ReadProduct, Permission.UpdateProduct])).toBe(true);
        });

        it('returns false if user has none of the permissions', () => {
            const ctx = createRequestContextWithPermissions([Permission.ReadOrder]);
            expect(ctx.userHasPermissions([Permission.ReadProduct, Permission.UpdateProduct])).toBe(false);
        });

        it('returns true for single permission match', () => {
            const ctx = createRequestContextWithPermissions([
                Permission.ReadProduct,
                Permission.UpdateProduct,
            ]);
            expect(ctx.userHasPermissions([Permission.ReadProduct])).toBe(true);
        });
    });

    describe('userHasAllPermissions', () => {
        it('returns false when no session', () => {
            const ctx = createRequestContextWithPermissions([], false);
            expect(ctx.userHasAllPermissions([Permission.ReadProduct])).toBe(false);
        });

        it('returns false when user has no permissions on channel', () => {
            const ctx = createRequestContextWithPermissions([]);
            expect(ctx.userHasAllPermissions([Permission.ReadProduct])).toBe(false);
        });

        it('returns true if user has ALL of the permissions (AND logic)', () => {
            const ctx = createRequestContextWithPermissions([
                Permission.ReadProduct,
                Permission.UpdateProduct,
            ]);
            expect(ctx.userHasAllPermissions([Permission.ReadProduct, Permission.UpdateProduct])).toBe(true);
        });

        it('returns false if user is missing any permission', () => {
            const ctx = createRequestContextWithPermissions([Permission.ReadProduct]);
            expect(ctx.userHasAllPermissions([Permission.ReadProduct, Permission.UpdateProduct])).toBe(false);
        });

        it('returns true for empty permissions array', () => {
            const ctx = createRequestContextWithPermissions([Permission.ReadProduct]);
            expect(ctx.userHasAllPermissions([])).toBe(true);
        });

        it('returns true for single permission match', () => {
            const ctx = createRequestContextWithPermissions([
                Permission.ReadProduct,
                Permission.UpdateProduct,
            ]);
            expect(ctx.userHasAllPermissions([Permission.ReadProduct])).toBe(true);
        });
    });

    function createRequestContext(req?: any) {
        const activeOrder = new Order({
            id: '55555',
            active: true,
            code: 'ADAWDJAWD',
        });
        const session = {
            cacheExpiry: Number.MAX_SAFE_INTEGER,
            expires: new Date(),
            id: '1234',
            token: '2d37187e9e8fc47807fe4f58ca',
            activeOrderId: '123',
            user: {
                id: '8833774',
                identifier: 'user',
                verified: true,
                channelPermissions: [],
            },
        } satisfies CachedSession;
        const zone = new Zone({
            id: '62626',
            name: 'Europe',
        });
        const channel = new Channel({
            token: 'oiajwodij09au3r',
            id: '995859',
            code: '__default_channel__',
            defaultCurrencyCode: CurrencyCode.EUR,
            pricesIncludeTax: true,
            defaultLanguageCode: LanguageCode.en,
            defaultShippingZone: zone,
            defaultTaxZone: zone,
        });
        return new RequestContext({
            apiType: 'admin',
            languageCode: LanguageCode.en,
            channel,
            session,
            req: req ?? {},
            isAuthorized: true,
            authorizedAsOwnerOnly: false,
        });
    }

    function createRequestContextWithPermissions(permissions: Permission[], withSession = true) {
        const zone = new Zone({
            id: '62626',
            name: 'Europe',
        });
        const channel = new Channel({
            token: 'oiajwodij09au3r',
            id: '995859',
            code: '__default_channel__',
            defaultCurrencyCode: CurrencyCode.EUR,
            pricesIncludeTax: true,
            defaultLanguageCode: LanguageCode.en,
            defaultShippingZone: zone,
            defaultTaxZone: zone,
        });
        const session: CachedSession | undefined = withSession
            ? {
                  cacheExpiry: Number.MAX_SAFE_INTEGER,
                  expires: new Date(),
                  id: '1234',
                  token: '2d37187e9e8fc47807fe4f58ca',
                  activeOrderId: '123',
                  user: {
                      id: '8833774',
                      identifier: 'user',
                      verified: true,
                      channelPermissions: [
                          { id: channel.id, token: channel.token, code: channel.code, permissions },
                      ],
                  },
              }
            : undefined;
        return new RequestContext({
            apiType: 'admin',
            languageCode: LanguageCode.en,
            channel,
            session,
            isAuthorized: true,
            authorizedAsOwnerOnly: false,
        });
    }
});
