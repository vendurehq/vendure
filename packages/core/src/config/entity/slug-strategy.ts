import { RequestContext } from '../../api/common/request-context';
import { InjectableStrategy } from '../../common/types/injectable-strategy';

/**
 * @description
 * Parameters for slug generation
 */
export interface SlugGenerateParams {
    /**
     * The input string to be converted to a slug
     */
    value: string;
    /**
     * The optional entity name (e.g., 'Product', 'Collection')
     */
    entityName?: string;
    /**
     * The optional field name (e.g., 'slug', 'code')
     */
    fieldName?: string;
}

/**
 * @description
 * Defines the strategy for generating slugs from input strings.
 * Slugs are URL-friendly versions of text that are commonly used for
 * entity identifiers in URLs.
 *
 * @example
 * ```ts
 * export class CustomSlugStrategy implements SlugStrategy {
 *   generate(ctx: RequestContext, params: SlugGenerateParams): string {
 *     return params.value
 *       .toLowerCase()
 *       .replace(/[^a-z0-9]+/g, '-')
 *       .replace(/^-+|-+$/g, '');
 *   }
 * }
 * ```
 *
 * @docsCategory configuration
 * @since 3.5.0
 */
export interface SlugStrategy extends InjectableStrategy {
    /**
     * @description
     * Generates a slug from the input string.
     *
     * @param ctx The request context
     * @param params The parameters for slug generation
     * @returns A URL-friendly slug string
     */
    generate(ctx: RequestContext, params: SlugGenerateParams): string | Promise<string>;
}
