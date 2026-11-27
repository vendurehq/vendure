import { describe, expect, it } from 'vitest';

import { readStoredRequestId, STORED_REQUEST_ID_KEY, withStoredRequestId } from './stored-request-id';

describe('stored request ID', () => {
    it('adds the request ID to object data, and reads it back', () => {
        const stored = withStoredRequestId({ a: 1 }, 'req-1');

        expect(stored).toEqual({ a: 1, [STORED_REQUEST_ID_KEY]: 'req-1' });
        expect(readStoredRequestId(stored)).toEqual({ data: { a: 1 }, requestId: 'req-1' });
    });

    it('does not change the data it was given', () => {
        const data = { a: 1 };

        withStoredRequestId(data, 'req-1');

        expect(data).toEqual({ a: 1 });
    });

    it('stores object data unchanged when there is no request ID', () => {
        const data = { a: 1 };

        expect(withStoredRequestId(data, undefined)).toBe(data);
        expect(readStoredRequestId(data)).toEqual({ data });
    });

    it('keeps the request ID through a second write, as on an update', () => {
        const { data, requestId } = readStoredRequestId(withStoredRequestId({ a: 1 }, 'req-1'));

        expect(readStoredRequestId(withStoredRequestId(data, requestId))).toEqual({
            data: { a: 1 },
            requestId: 'req-1',
        });
    });

    it('stores data which is not an object unchanged, without the request ID', () => {
        for (const data of ['text', 42, [1, 2], null]) {
            expect(withStoredRequestId(data, 'req-1')).toBe(data);
            expect(readStoredRequestId(data)).toEqual({ data });
        }
    });

    it('removes a stored value which is not a string, and reads no request ID', () => {
        expect(readStoredRequestId({ a: 1, [STORED_REQUEST_ID_KEY]: 5 })).toEqual({
            data: { a: 1 },
            requestId: undefined,
        });
    });
});
