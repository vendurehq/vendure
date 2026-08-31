import { CurrencyCode, LanguageCode, Permission } from '@vendure/common/lib/generated-types';
import { beforeAll, describe, expect, it } from 'vitest';

import { CachedSession } from '../../config/session-cache/session-cache-strategy';
import { Channel } from '../../entity/channel/channel.entity';
import { Order } from '../../entity/order/order.entity';
import { Zone } from '../../entity/zone/zone.entity';
import { MutableRequestContext } from '../../plugin/default-search-plugin/indexer/mutable-request-context';

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

        it('acceptedLanguageCodes', () => {
            const result = RequestContext.deserialize(serializedCtx);
            expect(result.acceptedLanguageCodes).toEqual(original.acceptedLanguageCodes);
        });

        it('acceptedLanguageCodes absent from a payload serialized before the field existed', () => {
            const { _acceptedLanguageCodes, ...withoutField } = serializedCtx;
            const result = RequestContext.deserialize(withoutField as SerializedRequestContext);
            expect(result.acceptedLanguageCodes).toEqual([]);
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

        it('session (without token)', () => {
            const result = RequestContext.deserialize(serializedCtx);
            // The session token is intentionally not serialized, so the deserialized session
            // matches the original minus its token.
            const { token, ...sessionWithoutToken } = original.session as CachedSession;
            expect(result.session).toEqual(sessionWithoutToken);
        });

        // The raw request object (and therefore all HTTP headers) and the session token must
        // never be written into the serialized context, which is persisted (e.g. in job data).
        it('does not serialize the session token', () => {
            expect((serializedCtx as any)._session.token).toBeUndefined();
        });

        it('does not serialize the raw request or its headers', () => {
            const requestContext = createRequestContext({
                headers: {
                    authorization: 'Bearer super-secret-token',
                    cookie: 'session=super-secret-cookie',
                },
            });

            const serialized = requestContext.serialize();
            const asJson = JSON.stringify(serialized);

            expect((serialized as any)._req).toBeUndefined();
            expect(asJson).not.toContain('super-secret-token');
            expect(asJson).not.toContain('super-secret-cookie');
        });

        // The serialized shape is an allowlist, so that a field added to RequestContext in
        // future is not persisted into job data without a deliberate decision.
        it('serializes only the allowlisted fields', () => {
            expect(Object.keys(serializedCtx).sort()).toEqual([
                '_acceptedLanguageCodes',
                '_apiType',
                '_authorizedAsOwnerOnly',
                '_channel',
                '_isAuthorized',
                '_languageCode',
                '_session',
            ]);
        });

        // The same holds one level down. CachedSession is where the session token lived, so a
        // secret added to it or to its user later must not reach job data by default.
        it('serializes only the allowlisted session fields', () => {
            const session = {
                cacheExpiry: Number.MAX_SAFE_INTEGER,
                expires: new Date(),
                id: '1234',
                token: '2d37187e9e8fc47807fe4f58ca',
                activeOrderId: '123',
                activeChannelId: '995859',
                authenticationStrategy: 'native',
                refreshToken: 'not-a-cached-session-field',
                user: {
                    id: '8833774',
                    identifier: 'user',
                    verified: true,
                    channelPermissions: [],
                    mfaSecret: 'not-a-cached-session-user-field',
                },
            };
            const serialized = createRequestContext(undefined, session as CachedSession).serialize();

            expect(Object.keys(serialized._session).sort()).toEqual([
                'activeChannelId',
                'activeOrderId',
                'authenticationStrategy',
                'cacheExpiry',
                'expires',
                'id',
                'user',
            ]);
            expect(Object.keys(serialized._session.user).sort()).toEqual([
                'channelPermissions',
                'id',
                'identifier',
                'verified',
            ]);
        });

        // https://github.com/vendurehq/vendure/issues/864
        // The Express request holds circular references. serialize() must not walk it.
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

            expect(() => requestContext.serialize()).not.toThrow();
            expect((requestContext.serialize() as any)._req).toBeUndefined();
        });

        // Job.ensureDataIsSerializable() prefers toJSON() over walking the instance, so a
        // RequestContext passed straight into job data must serialize the same way.
        it('JSON.stringify uses serialize()', () => {
            const requestContext = createRequestContext({
                headers: {
                    authorization: 'Bearer super-secret-token',
                    cookie: 'session=super-secret-cookie',
                },
            });

            const asJson = JSON.stringify(requestContext);

            expect(JSON.parse(asJson)).toEqual(requestContext.serialize());
            expect(asJson).not.toContain('super-secret-token');
            expect(asJson).not.toContain('super-secret-cookie');
            expect(asJson).not.toContain('2d37187e9e8fc47807fe4f58ca');
        });
    });

    // Job data written before GHSA-32jm-mf7r-7qw5 was fixed still holds `_req` and a session
    // token. Both deserializers must accept it and must not carry either through.
    describe('deserialize a context serialized before the fix', () => {
        const legacySerializedCtx = {
            _apiType: 'admin',
            _channel: { id: '995859', code: '__default_channel__' },
            _languageCode: LanguageCode.en,
            _isAuthorized: true,
            _authorizedAsOwnerOnly: false,
            _currencyCode: CurrencyCode.EUR,
            _session: {
                id: '1234',
                token: 'legacy-session-token',
                expires: new Date().toISOString(),
                activeOrderId: '123',
                user: {
                    id: '8833774',
                    identifier: 'user',
                    verified: true,
                    channelPermissions: [
                        { id: '995859', token: 'ch-token', code: 'default', permissions: [] },
                    ],
                },
            },
            _req: { headers: { authorization: 'Bearer legacy-session-token' } },
        } as unknown as SerializedRequestContext;

        for (const [name, deserialize] of [
            ['RequestContext', (input: SerializedRequestContext) => RequestContext.deserialize(input)],
            [
                'MutableRequestContext',
                (input: SerializedRequestContext) => MutableRequestContext.deserialize(input),
            ],
        ] as const) {
            it(`${name} deserializes it without a request or a token`, () => {
                const result = deserialize(legacySerializedCtx);

                expect(result.req).toBeUndefined();
                expect(result.session?.token).toBeUndefined();
                expect(result.activeUserId).toBe('8833774');
                expect(result.session?.activeOrderId).toBe('123');
                expect(result.session?.user?.channelPermissions).toEqual([
                    { id: '995859', token: 'ch-token', code: 'default', permissions: [] },
                ]);
                expect(result.channelId).toBe('995859');
                expect(result.languageCode).toBe(LanguageCode.en);
            });
        }
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
            expect(copy.acceptedLanguageCodes).toEqual(original.acceptedLanguageCodes);
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

    function createRequestContext(req?: any, sessionOverride?: CachedSession) {
        const activeOrder = new Order({
            id: '55555',
            active: true,
            code: 'ADAWDJAWD',
        });
        const session: CachedSession = sessionOverride ?? {
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
        };
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
            acceptedLanguageCodes: [LanguageCode.ja, LanguageCode.de],
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
