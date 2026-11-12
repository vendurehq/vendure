import { RequestContext } from '../../api/common/request-context';

import { SlugGenerateParams, SlugStrategy, SlugUniquenessScope } from './slug-strategy';

/**
 * @description
 * Options for the {@link DefaultSlugStrategy}.
 *
 * @docsCategory configuration
 * @docsPage DefaultSlugStrategy
 * @since 4.0.0
 */
export interface DefaultSlugStrategyOptions {
    /**
     * @description
     * The scope within which Product and Collection slugs must be unique. Use `'global'` when a
     * single storefront shows several channels' products, such as a marketplace built on the
     * default channel.
     *
     * @default 'channel'
     */
    uniqueness?: SlugUniquenessScope;
}

/**
 * @description
 * The default strategy for generating slugs. This strategy:
 * - Converts to lowercase
 * - Replaces spaces and special characters with hyphens
 * - Removes non-alphanumeric characters (except hyphens)
 * - Removes leading and trailing hyphens
 * - Collapses multiple hyphens into one
 *
 * @example
 * ```ts
 * const strategy = new DefaultSlugStrategy();
 * strategy.generate(ctx, { value: "Hello World!" }); // "hello-world"
 * strategy.generate(ctx, { value: "Café Français" }); // "cafe-francais"
 * strategy.generate(ctx, { value: "100% Natural" }); // "100-natural"
 * ```
 *
 * Slugs are unique per channel by default. To make them unique across all channels:
 *
 * ```ts
 * entityOptions: {
 *   slugStrategy: new DefaultSlugStrategy({ uniqueness: 'global' }),
 * },
 * ```
 *
 * @docsCategory configuration
 * @since 3.5.0
 */
export class DefaultSlugStrategy implements SlugStrategy {
    constructor(private readonly options: DefaultSlugStrategyOptions = {}) {}

    getUniquenessScope(): SlugUniquenessScope {
        return this.options.uniqueness ?? 'channel';
    }

    generate(ctx: RequestContext, params: SlugGenerateParams): string {
        const { value } = params;
        if (!value) {
            return '';
        }

        const result = value
            .normalize('NFD') // Normalize unicode characters
            .replace(/[\u0300-\u036f]/g, '') // Remove diacritical marks
            .toLowerCase()
            .trim()
            .replace(/[^a-z0-9\s-]/g, '') // Remove special characters except spaces and hyphens
            .replace(/\s+/g, '-'); // Replace spaces with hyphens

        // Split by hyphen, filter out empty strings, and rejoin to handle multiple hyphens
        return result
            .split('-')
            .filter(part => part.length > 0)
            .join('-');
    }
}
