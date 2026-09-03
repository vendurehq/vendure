import { RequestContext } from '@vendure/core';
import { describe, expect, it, vi } from 'vitest';

import { McpShopSessionService, ShopSessionOutcome } from './mcp-shop-session.service';

const ANON_SESSION = { id: 'anon-id', token: 'anon-token', expires: new Date(Date.now() + 60_000) };

function build() {
    const sessionService = {
        getSessionFromToken: vi.fn((_token: string) => Promise.resolve(undefined as unknown)),
        createAnonymousSession: vi.fn(() => Promise.resolve(ANON_SESSION)),
    };
    return { service: new McpShopSessionService(sessionService as never), sessionService };
}

/** A real RequestContext (the resolver clones it via copy()), with cast channel/session fakes. */
function fakeCtx(over: { req?: unknown; session?: unknown } = {}) {
    return new RequestContext({
        apiType: 'shop',
        channel: { id: 'ch1' } as never,
        languageCode: 'en' as never,
        currencyCode: 'USD' as never,
        req: over.req as never,
        session: over.session as never,
        isAuthorized: false,
        authorizedAsOwnerOnly: true,
    });
}

/** Narrows to the resolved outcome, failing the test on any other kind. */
function resolved(outcome: ShopSessionOutcome) {
    if (outcome.kind !== 'resolved') {
        throw new Error(`expected a resolved outcome, got "${outcome.kind}"`);
    }
    return outcome;
}

describe('McpShopSessionService', () => {
    describe('prepareToolCall', () => {
        it('strips sessionToken and returns the context that carries the resolved session', async () => {
            const { service, sessionService } = build();
            const session = { id: 's1', token: 'existing-token', expires: new Date(Date.now() + 60_000) };
            sessionService.getSessionFromToken.mockResolvedValue(session);

            const outcome = await service.prepareToolCall({
                ctx: fakeCtx(),
                input: { note: 'hello', sessionToken: 'existing-token' },
                isOAuthCall: false,
                toolWritesToCart: false,
            });

            expect(outcome).toMatchObject({
                kind: 'prepared',
                input: { note: 'hello' },
                sessionToken: 'existing-token',
            });
            if (outcome.kind !== 'prepared') throw new Error('unexpected refusal');
            expect(outcome.ctx.session).toBe(session);
        });

        it('keeps an unchanged context and strips the empty carrier field', async () => {
            const { service } = build();
            const ctx = fakeCtx();

            const outcome = await service.prepareToolCall({
                ctx,
                input: { sessionToken: undefined },
                isOAuthCall: false,
                toolWritesToCart: false,
            });

            expect(outcome).toEqual({ kind: 'prepared', ctx, input: {} });
        });
    });

    describe('addSessionTokenToResult', () => {
        it('adds the token to an object result', () => {
            const { service } = build();
            expect(service.addSessionTokenToResult({ order: null }, 'token')).toEqual({
                order: null,
                sessionToken: 'token',
            });
        });

        it('wraps a non-object result so the token remains recoverable', () => {
            const { service } = build();
            expect(service.addSessionTokenToResult(['a', 'b'], 'token')).toEqual({
                result: ['a', 'b'],
                sessionToken: 'token',
            });
        });
    });

    describe('resolveForToolCall', () => {
        it('refuses a sessionToken argument on an OAuth-authenticated call', async () => {
            const { service, sessionService } = build();
            const outcome = await service.resolveForToolCall({
                ctx: fakeCtx(),
                sessionToken: 'anything',
                isOAuthCall: true,
                toolWritesToCart: true,
            });
            expect(outcome).toEqual({ kind: 'refused', message: expect.stringMatching(/omit it/i) });
            expect(sessionService.getSessionFromToken).not.toHaveBeenCalled();
        });

        it('leaves an OAuth-authenticated call without a token argument unchanged', async () => {
            const { service } = build();
            const outcome = await service.resolveForToolCall({
                ctx: fakeCtx(),
                sessionToken: undefined,
                isOAuthCall: true,
                toolWritesToCart: true,
            });
            expect(outcome).toEqual({ kind: 'unchanged' });
        });

        it('refuses an unknown or expired token with retry wording that fits every shop tool', async () => {
            const { service } = build();
            const outcome = await service.resolveForToolCall({
                ctx: fakeCtx(),
                sessionToken: 'gone',
                isOAuthCall: false,
                toolWritesToCart: false,
            });
            expect(outcome).toEqual({
                kind: 'refused',
                message: expect.stringMatching(
                    /not valid or has expired.*Retry the call without sessionToken/s,
                ),
            });
        });

        it("refuses a signed-in user's token", async () => {
            const { service, sessionService } = build();
            sessionService.getSessionFromToken.mockResolvedValue({ id: 's2', token: 't', user: { id: 1 } });
            const outcome = await service.resolveForToolCall({
                ctx: fakeCtx(),
                sessionToken: 't',
                isOAuthCall: false,
                toolWritesToCart: true,
            });
            expect(outcome).toEqual({
                kind: 'refused',
                message: expect.stringMatching(/belongs to a signed-in user/),
            });
        });

        it('refuses a sessionToken argument when the context already belongs to a signed-in user (in-process call)', async () => {
            const { service, sessionService } = build();
            sessionService.getSessionFromToken.mockResolvedValue({ ...ANON_SESSION });
            const outcome = await service.resolveForToolCall({
                ctx: fakeCtx({ session: { id: 's1', token: 'customer-token', user: { id: 7 } } }),
                sessionToken: 'anon-token',
                isOAuthCall: false,
                toolWritesToCart: true,
            });
            expect(outcome).toEqual({ kind: 'refused', message: expect.stringMatching(/omit it/i) });
            expect(sessionService.getSessionFromToken).not.toHaveBeenCalled();
        });

        it('resolves a valid anonymous token to a copied context carrying the session, and echoes the token', async () => {
            const { service, sessionService } = build();
            const session = { id: 's1', token: 'existing-token', expires: new Date(Date.now() + 60_000) };
            sessionService.getSessionFromToken.mockResolvedValue(session);
            const req = { headers: { 'x-probe': '1' } };
            const outcome = resolved(
                await service.resolveForToolCall({
                    ctx: fakeCtx({ req }),
                    sessionToken: 'existing-token',
                    isOAuthCall: false,
                    toolWritesToCart: false,
                }),
            );
            expect(outcome.sessionToken).toBe('existing-token');
            expect(outcome.ctx).toBeInstanceOf(RequestContext);
            expect(outcome.ctx.session).toBe(session);
            // copy() keeps everything else the request carried.
            expect(outcome.ctx.req).toBe(req);
            expect(outcome.ctx.currencyCode).toBe('USD');
            expect(outcome.ctx.languageCode).toBe('en');
            expect(outcome.ctx.channel).toEqual({ id: 'ch1' });
            expect(outcome.ctx.apiType).toBe('shop');
        });

        it('re-reads a context session through the cache and swaps to the fresh copy', async () => {
            const { service, sessionService } = build();
            const fresh = { id: 's1', token: 'header-token', activeOrderId: 'o9', expires: new Date() };
            sessionService.getSessionFromToken.mockResolvedValue(fresh);
            const outcome = resolved(
                await service.resolveForToolCall({
                    ctx: fakeCtx({ session: { id: 's1', token: 'header-token' } }),
                    sessionToken: undefined,
                    isOAuthCall: false,
                    toolWritesToCart: false,
                }),
            );
            expect(sessionService.getSessionFromToken).toHaveBeenCalledWith('header-token');
            expect(outcome.ctx.session).toBe(fresh);
            expect(outcome.sessionToken).toBe('header-token');
        });

        it('leaves the context alone when the re-read misses (in-process session may not be database-backed)', async () => {
            const { service } = build();
            const outcome = await service.resolveForToolCall({
                ctx: fakeCtx({ session: { id: 's1', token: 'not-in-db' } }),
                sessionToken: undefined,
                isOAuthCall: false,
                toolWritesToCart: true,
            });
            expect(outcome).toEqual({ kind: 'unchanged' });
        });

        it('creates an anonymous session only when the tool writes to the cart', async () => {
            const { service, sessionService } = build();
            const readonly = await service.resolveForToolCall({
                ctx: fakeCtx(),
                sessionToken: undefined,
                isOAuthCall: false,
                toolWritesToCart: false,
            });
            expect(readonly).toEqual({ kind: 'unchanged' });
            expect(sessionService.createAnonymousSession).not.toHaveBeenCalled();

            const writing = resolved(
                await service.resolveForToolCall({
                    ctx: fakeCtx(),
                    sessionToken: undefined,
                    isOAuthCall: false,
                    toolWritesToCart: true,
                }),
            );
            expect(sessionService.createAnonymousSession).toHaveBeenCalledOnce();
            expect(writing.sessionToken).toBe('anon-token');
        });

        it('treats a blank sessionToken argument as no token, the same as leaving it out', async () => {
            const { service, sessionService } = build();
            for (const blank of ['', '   ']) {
                const outcome = resolved(
                    await service.resolveForToolCall({
                        ctx: fakeCtx(),
                        sessionToken: blank,
                        isOAuthCall: false,
                        toolWritesToCart: true,
                    }),
                );
                expect(outcome.sessionToken).toBe('anon-token');
            }
            expect(sessionService.getSessionFromToken).not.toHaveBeenCalled();
            expect(sessionService.createAnonymousSession).toHaveBeenCalledTimes(2);
        });

        it('does not refuse a blank sessionToken argument on an OAuth-authenticated call', async () => {
            const { service } = build();
            const outcome = await service.resolveForToolCall({
                ctx: fakeCtx(),
                sessionToken: '',
                isOAuthCall: true,
                toolWritesToCart: true,
            });
            expect(outcome).toEqual({ kind: 'unchanged' });
        });

        it('looks up a token that arrived with surrounding whitespace', async () => {
            const { service, sessionService } = build();
            const session = { id: 's1', token: 'padded-token', expires: new Date(Date.now() + 60_000) };
            sessionService.getSessionFromToken.mockResolvedValue(session);
            const outcome = resolved(
                await service.resolveForToolCall({
                    ctx: fakeCtx(),
                    sessionToken: '  padded-token\n',
                    isOAuthCall: false,
                    toolWritesToCart: false,
                }),
            );
            expect(sessionService.getSessionFromToken).toHaveBeenCalledWith('padded-token');
            expect(outcome.sessionToken).toBe('padded-token');
        });

        it('never echoes the token of a session that has a user', async () => {
            const { service, sessionService } = build();
            const userSession = { id: 's3', token: 'user-token', user: { id: 1 }, expires: new Date() };
            sessionService.getSessionFromToken.mockResolvedValue(userSession);
            const outcome = resolved(
                await service.resolveForToolCall({
                    ctx: fakeCtx({ session: { id: 's3', token: 'user-token' } }),
                    sessionToken: undefined,
                    isOAuthCall: false,
                    toolWritesToCart: false,
                }),
            );
            expect(outcome.ctx.session).toBe(userSession);
            expect(outcome.sessionToken).toBeUndefined();
        });
    });

    describe('resolveHeaderToken', () => {
        it('resolves a missing or unknown token to no session so the request proceeds session-less', async () => {
            const { service } = build();
            expect(await service.resolveHeaderToken(undefined)).toEqual({ kind: 'resolved' });
            expect(await service.resolveHeaderToken('gone')).toEqual({
                kind: 'resolved',
                session: undefined,
            });
        });

        it('returns the anonymous session for a valid token', async () => {
            const { service, sessionService } = build();
            const session = { id: 's1', token: 't1', expires: new Date() };
            sessionService.getSessionFromToken.mockResolvedValue(session);
            expect(await service.resolveHeaderToken('t1')).toEqual({ kind: 'resolved', session });
        });

        it('treats a blank header value as no token', async () => {
            const { service, sessionService } = build();
            expect(await service.resolveHeaderToken('')).toEqual({ kind: 'resolved', session: undefined });
            expect(await service.resolveHeaderToken('   ')).toEqual({ kind: 'resolved', session: undefined });
            expect(sessionService.getSessionFromToken).not.toHaveBeenCalled();
        });

        it("refuses a signed-in user's token with the shared wording", async () => {
            const { service, sessionService } = build();
            sessionService.getSessionFromToken.mockResolvedValue({ id: 's2', token: 't2', user: { id: 1 } });
            const outcome = await service.resolveHeaderToken('t2');
            expect(outcome).toEqual({
                kind: 'refused',
                message: expect.stringMatching(/belongs to a signed-in user/),
            });
        });
    });
});
