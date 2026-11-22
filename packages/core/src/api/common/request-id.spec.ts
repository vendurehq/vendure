import { describe, expect, it, vi } from 'vitest';

import {
    getRequestId,
    getRequestIdOfRequest,
    REQUEST_ID_HEADER,
    requestIdMiddleware,
    resolveRequestId,
    runWithRequestId,
} from './request-id';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

describe('request ID', () => {
    describe('resolveRequestId()', () => {
        it('accepts a short ID of safe characters', () => {
            expect(resolveRequestId('abc-123_DEF.4:5')).toBe('abc-123_DEF.4:5');
        });

        it('accepts an ID of 128 characters', () => {
            const id = 'a'.repeat(128);
            expect(resolveRequestId(id)).toBe(id);
        });

        it('generates an ID when there is none', () => {
            expect(resolveRequestId(undefined)).toMatch(UUID);
        });

        it('generates an ID instead of one longer than 128 characters', () => {
            expect(resolveRequestId('a'.repeat(129))).toMatch(UUID);
        });

        it('generates an ID instead of one with unsafe characters', () => {
            expect(resolveRequestId('abc\ninjected')).toMatch(UUID);
            expect(resolveRequestId('abc def')).toMatch(UUID);
            expect(resolveRequestId('<script>')).toMatch(UUID);
            expect(resolveRequestId('')).toMatch(UUID);
        });

        it('generates an ID instead of a repeated header', () => {
            expect(resolveRequestId(['a', 'b'])).toMatch(UUID);
        });

        it('generates a different ID each time', () => {
            expect(resolveRequestId(undefined)).not.toBe(resolveRequestId(undefined));
        });
    });

    describe('runWithRequestId()', () => {
        it('makes the ID current inside the function and across awaits', async () => {
            const seen = await runWithRequestId('req-1', async () => {
                await new Promise(resolve => setTimeout(resolve, 1));
                return getRequestId();
            });
            expect(seen).toBe('req-1');
            expect(getRequestId()).toBeUndefined();
        });

        it('clears the current ID when given none', () => {
            const seen = runWithRequestId('outer', () => runWithRequestId(undefined, () => getRequestId()));
            expect(seen).toBeUndefined();
        });
    });

    describe('requestIdMiddleware()', () => {
        function run(headers: Record<string, string>) {
            const req: any = { headers };
            const res: any = { setHeader: vi.fn() };
            let idInNext: string | undefined;
            requestIdMiddleware(req, res, () => {
                idInNext = getRequestId();
            });
            return { req, res, idInNext };
        }

        it('uses the inbound ID for the request, the response header and the rest of the request', () => {
            const { req, res, idInNext } = run({ [REQUEST_ID_HEADER]: 'inbound-1' });
            expect(idInNext).toBe('inbound-1');
            expect(getRequestIdOfRequest(req)).toBe('inbound-1');
            expect(res.setHeader).toHaveBeenCalledWith(REQUEST_ID_HEADER, 'inbound-1');
        });

        it('generates an ID when the request has none', () => {
            const { req, res, idInNext } = run({});
            expect(idInNext).toMatch(UUID);
            expect(getRequestIdOfRequest(req)).toBe(idInNext);
            expect(res.setHeader).toHaveBeenCalledWith(REQUEST_ID_HEADER, idInNext);
        });
    });
});
