import { describe, expect, it } from 'vitest';
import { parseUploadResponse } from './api.js';

describe('parseUploadResponse', () => {
    it('returns success with the parsed data for a clean 200 response', () => {
        const xhr = {
            status: 200,
            responseText: JSON.stringify({ data: { createAssets: [{ __typename: 'Asset', id: '1' }] } }),
        };

        expect(parseUploadResponse(xhr)).toEqual({
            success: true,
            data: { createAssets: [{ __typename: 'Asset', id: '1' }] },
        });
    });

    it('returns a FILE_TOO_LARGE failure for a 413 response', () => {
        const xhr = { status: 413, responseText: '' };

        expect(parseUploadResponse(xhr)).toEqual({ success: false, code: 'FILE_TOO_LARGE' });
    });

    it('returns a SERVER_ERROR failure when the response has a top-level GraphQL error', () => {
        const xhr = { status: 200, responseText: JSON.stringify({ errors: [{ message: 'Something went wrong' }] }) };

        expect(parseUploadResponse(xhr)).toEqual({
            success: false,
            code: 'SERVER_ERROR',
            detail: 'Something went wrong',
        });
    });

    it('returns an INVALID_RESPONSE failure when a 200 body is not valid JSON', () => {
        const xhr = { status: 200, responseText: '<html>502 Bad Gateway</html>' };

        expect(parseUploadResponse(xhr)).toEqual({ success: false, code: 'INVALID_RESPONSE' });
    });

    it('returns an INVALID_RESPONSE failure when a 200 body has no data', () => {
        const xhr = { status: 200, responseText: JSON.stringify({}) };

        expect(parseUploadResponse(xhr)).toEqual({ success: false, code: 'INVALID_RESPONSE' });
    });

    it('returns an HTTP_ERROR failure for other non-2xx statuses', () => {
        const xhr = { status: 500, responseText: '' };

        expect(parseUploadResponse(xhr)).toEqual({ success: false, code: 'HTTP_ERROR', detail: '500' });
    });
});
