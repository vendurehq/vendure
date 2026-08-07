import { Request } from 'express';
import { describe, expect, it } from 'vitest';

import { getAssetUrlPrefixFn } from './common';
import { AssetServerOptions } from './types';

describe('getAssetUrlPrefixFn', () => {
    it('uses the forwarded host when generating asset URLs behind a proxy', () => {
        const getPrefix = getAssetUrlPrefixFn({ route: 'assets' } as AssetServerOptions);
        const request = {
            headers: {
                'x-forwarded-proto': 'https',
                'x-forwarded-host': 'puebla.vendure.localhost',
            },
            protocol: 'http',
            get: (header: string) => (header === 'host' ? '127.0.0.1:4145' : undefined),
        } as Request;

        expect(getPrefix(request, 'avatar.webp')).toBe('https://puebla.vendure.localhost/assets/');
    });
});
