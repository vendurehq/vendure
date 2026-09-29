import { describe, expect, it } from 'vitest';
import {
    allUploadsFinished,
    interpretUploadResult,
    overallProgress,
    runWithConcurrencyLimit,
    withUpdatedUpload,
} from './asset-upload-modal.js';

function upload(status: 'queued' | 'uploading' | 'done' | 'error', progress = 0) {
    return { file: new File(['x'], 'x.png'), status, progress };
}

describe('overallProgress', () => {
    it('returns 0 for an empty list', () => {
        expect(overallProgress([])).toBe(0);
    });

    it('averages progress across all files', () => {
        expect(overallProgress([upload('uploading', 0), upload('uploading', 100)])).toBe(50);
    });

    it('rounds to the nearest whole percent', () => {
        expect(overallProgress([upload('uploading', 0), upload('uploading', 0), upload('uploading', 100)])).toBe(33);
    });
});

describe('allUploadsFinished', () => {
    it('is false for an empty list', () => {
        expect(allUploadsFinished([])).toBe(false);
    });

    it('is false while any file is still queued or uploading', () => {
        expect(allUploadsFinished([upload('done'), upload('uploading')])).toBe(false);
    });

    it('is true once every file has reached a terminal status', () => {
        expect(allUploadsFinished([upload('done'), upload('error')])).toBe(true);
    });
});

describe('withUpdatedUpload', () => {
    it('patches only the upload at the given index', () => {
        const uploads = [upload('queued'), upload('queued')];

        const result = withUpdatedUpload(uploads, 1, { status: 'uploading', progress: 40 });

        expect(result[0]).toEqual(uploads[0]);
        expect(result[1]).toMatchObject({ status: 'uploading', progress: 40 });
    });
});

describe('interpretUploadResult', () => {
    it('passes a transport-level failure straight through', () => {
        const result = interpretUploadResult({ success: false, code: 'NETWORK_ERROR' });

        expect(result).toEqual({ success: false, code: 'NETWORK_ERROR', detail: undefined });
    });

    it('is a success when the server returns an Asset', () => {
        const result = interpretUploadResult({
            success: true,
            data: { createAssets: [{ __typename: 'Asset', id: '1' }] } as any,
        });

        expect(result).toEqual({ success: true });
    });

    it('is a REJECTED failure when the server accepts the request but rejects the file', () => {
        const result = interpretUploadResult({
            success: true,
            data: { createAssets: [{ __typename: 'MimeTypeError', message: 'Invalid mime type' }] } as any,
        });

        expect(result).toEqual({ success: false, code: 'REJECTED', detail: 'Invalid mime type' });
    });
});

describe('runWithConcurrencyLimit', () => {
    it('runs every item exactly once', async () => {
        const items = [1, 2, 3, 4, 5];
        const seen: number[] = [];

        await runWithConcurrencyLimit(items, 2, async item => {
            seen.push(item);
        });

        expect(seen.sort()).toEqual(items);
    });

    it('never runs more than `limit` items at the same time', async () => {
        const items = [1, 2, 3, 4, 5, 6];
        let active = 0;
        let maxActive = 0;

        await runWithConcurrencyLimit(items, 2, async () => {
            active++;
            maxActive = Math.max(maxActive, active);
            await new Promise(resolve => setTimeout(resolve, 5));
            active--;
        });

        expect(maxActive).toBeLessThanOrEqual(2);
    });
});
