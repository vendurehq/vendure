import { afterEach, describe, expect, it, vi } from 'vitest';

import { configResolverPackages } from '../../../shared/load-project-config.js';

import { run } from './create-new-plugin.run.js';

vi.mock('../../../shared/open-project.js', () => ({
    openProject: vi.fn(() =>
        Promise.resolve({ project: { getSourceFiles: () => [] }, vendureTsConfig: undefined }),
    ),
}));
vi.mock('../../../shared/vendure-config-ref.js', () => ({
    VendureConfigRef: vi.fn(function () {
        throw new Error('Could not find the VendureConfig declaration in your project.');
    }),
}));
vi.mock('../../../shared/load-project-config.js', () => ({
    configResolverPackages: vi.fn(() => []),
}));

describe('vendure add plugin without a VendureConfig in the source', () => {
    afterEach(() => {
        vi.clearAllMocks();
    });

    it('names the packages whose config resolver may provide the config', async () => {
        vi.mocked(configResolverPackages).mockReturnValueOnce([
            { packageName: '@acme/cloud' } as ReturnType<typeof configResolverPackages>[number],
        ]);

        const result = await run({ name: 'reviews', dir: '/nonexistent/reviews-plugin' });

        expect(result).toMatchObject({
            code: 'add.vendure-config-not-found',
            details: {
                message:
                    "Could not find the VendureConfig declaration in your project. This project's config may come " +
                    'from the config resolver of @acme/cloud, which is not a file this command can add the plugin to',
            },
        });
    });

    it('reports the error as it is when no package has a config resolver', async () => {
        const result = await run({ name: 'reviews', dir: '/nonexistent/reviews-plugin' });

        expect(result).toMatchObject({
            code: 'add.vendure-config-not-found',
            details: { message: 'Could not find the VendureConfig declaration in your project.' },
        });
    });
});
