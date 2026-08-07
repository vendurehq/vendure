import type { AssetImportStrategy, AssetService, RequestContext } from '@vendure/core';
import { DefaultAssetImportStrategy, UserInputError } from '@vendure/core';
import { Readable } from 'stream';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { uploadAssetFromUrl } from './remote-asset';

const ctx = {} as unknown as RequestContext;

/**
 * A fake AssetService whose createFromFileStream fully drains the stream, mirroring what the real
 * service does (it reads the bytes to generate a preview). Draining is what lets a mid-stream failure
 * such as the byte-cap overflow surface as a rejected promise.
 */
function drainingAssetService(result: unknown = { id: 'A_1', name: 'logo.png' }) {
    const createFromFileStream = vi.fn(
        (stream: Readable) =>
            new Promise((resolve, reject) => {
                stream.on('data', () => undefined);
                stream.on('end', () => resolve(result));
                stream.on('error', reject);
            }),
    );
    return {
        assetService: { createFromFileStream } as unknown as AssetService,
        createFromFileStream,
    };
}

/** A stub strategy returning the chunks as a binary stream, like core's http fetcher (not object-mode). */
function stubStrategy(chunks: Buffer[]) {
    const getStreamFromPath = vi.fn(() => Readable.from(chunks, { objectMode: false }));
    return {
        strategy: { getStreamFromPath } as unknown as AssetImportStrategy,
        getStreamFromPath,
    };
}

afterEach(() => vi.restoreAllMocks());

describe('uploadAssetFromUrl', () => {
    it('rejects a non-http(s) URL without touching the import strategy', async () => {
        // A non-http(s) input would otherwise fall through to core's local-file branch (a path.join
        // under importAssetsDir), turning this into a local file reader — so it must be rejected here.
        const getStreamFromPath = vi.fn();
        const strategy = { getStreamFromPath } as unknown as AssetImportStrategy;
        const { assetService, createFromFileStream } = drainingAssetService();

        await expect(uploadAssetFromUrl(ctx, 'file:///etc/passwd', assetService, strategy)).rejects.toThrow(
            /scheme/i,
        );

        await expect(uploadAssetFromUrl(ctx, 'file:///etc/passwd', assetService, strategy)).rejects.toThrow(
            UserInputError,
        );
        expect(getStreamFromPath).not.toHaveBeenCalled();
        expect(createFromFileStream).not.toHaveBeenCalled();
    });

    it('creates an asset from the fetched stream over an http(s) URL', async () => {
        const { strategy, getStreamFromPath } = stubStrategy([Buffer.from('pretend-image-bytes')]);
        const { assetService, createFromFileStream } = drainingAssetService();

        const result = await uploadAssetFromUrl(
            ctx,
            'http://assets.example/logo.png',
            assetService,
            strategy,
        );

        expect(getStreamFromPath).toHaveBeenCalledWith('http://assets.example/logo.png');
        expect(createFromFileStream).toHaveBeenCalledOnce();
        const [stream, filePath] = createFromFileStream.mock.calls[0];
        expect(stream).toBeInstanceOf(Readable);
        expect(filePath).toBe('http://assets.example/logo.png');
        expect(result).toEqual({ id: 'A_1', name: 'logo.png' });
    });

    it('rejects when the streamed body exceeds the byte cap', async () => {
        // Two 80-byte chunks over a 100-byte cap: the cap must fire mid-stream, not rely on a declared
        // Content-Length (which core does not expose to us).
        const { strategy } = stubStrategy([Buffer.alloc(80), Buffer.alloc(80)]);
        const { assetService } = drainingAssetService();

        await expect(
            uploadAssetFromUrl(ctx, 'http://big.example/img', assetService, strategy, { maxBytes: 100 }),
        ).rejects.toThrow(/maximum size/);

        // The class must survive the trip through the stream pipeline: UserInputError is on the tool
        // funnel's caller-safe list, so this message reaches the caller.
        const { strategy: strategy2 } = stubStrategy([Buffer.alloc(80), Buffer.alloc(80)]);
        const { assetService: assetService2 } = drainingAssetService();
        await expect(
            uploadAssetFromUrl(ctx, 'http://big.example/img', assetService2, strategy2, { maxBytes: 100 }),
        ).rejects.toThrow(UserInputError);
    });
});

describe('SSRF hardening is delegated to the core DefaultAssetImportStrategy', () => {
    // The private/reserved-IP block, DNS-rebinding closure (IP pinning) and timeout now live in core's
    // fetcher (assertPublicUrl + fetchUrl). These checks confirm the plugin routes a caller-supplied URL
    // through that guard rather than re-implementing it — they exercise the real strategy, no server.
    it.each(['http://127.0.0.1:9/', 'http://[::1]:9/', 'http://169.254.169.254/latest/meta-data/'])(
        'rejects the non-public URL %s via the core guard',
        async url => {
            const { assetService, createFromFileStream } = drainingAssetService();

            // Assert on the behaviour (rejected, no asset created) rather than core's exact message,
            // which the plugin does not own and which would make this test brittle to a core reword.
            await expect(
                uploadAssetFromUrl(ctx, url, assetService, new DefaultAssetImportStrategy()),
            ).rejects.toThrow();
            expect(createFromFileStream).not.toHaveBeenCalled();
        },
    );
});
