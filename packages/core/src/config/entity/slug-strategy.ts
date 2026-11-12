import { ID } from '@vendure/common/lib/shared-types';

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
 * The scope within which a slug must be unique (per language).
 *
 * - `'channel'`: unique in each channel the entity belongs to. The default channel holds every
 *   entity, so it only counts for entities that belong to no other channel.
 * - `'global'`: unique across all channels.
 *
 * The scope is checked when a slug is saved and when an entity is assigned to a channel. It is
 * not checked when an entity is removed from a channel or a channel is deleted. So with
 * `'channel'`, two entities from different channels can both end up only in the default
 * channel with the same slug. Lookups by that slug then return the oldest entity.
 * `findSlugConflicts()` lists such duplicates. Run it before switching an existing database
 * to `'global'` as well, since slugs that are saved unchanged are not checked again.
 *
 * @docsCategory configuration
 * @docsPage SlugStrategy
 * @since 4.0.0
 */
export type SlugUniquenessScope = 'channel' | 'global';

/**
 * @description
 * Parameters for {@link SlugStrategy}`.getUniquenessScope()`.
 *
 * @docsCategory configuration
 * @docsPage SlugStrategy
 * @since 4.0.0
 */
export interface SlugUniquenessScopeParams {
    /**
     * The name of the entity that owns the slug, e.g. `'Product'` or `'Collection'`.
     */
    entityName: string;
    /**
     * The id of the entity, or undefined when it is being created.
     */
    entityId?: ID;
    /**
     * The channels the entity belongs to, or will belong to: for a new entity, the active
     * channel; for an assignment, the target channel.
     */
    channelIds: ID[];
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

    /**
     * @description
     * Returns the scope within which a Product or Collection slug must be unique. It is used
     * when a slug is validated on create and update, when an entity is assigned to a channel,
     * and by the `slugForEntity` query, so that the dashboard suggestions agree with the
     * validation. It does not affect how the slug text is generated.
     *
     * If not implemented, the scope is `'channel'`.
     *
     * @since 4.0.0
     * @default 'channel'
     */
    getUniquenessScope?(
        ctx: RequestContext,
        params: SlugUniquenessScopeParams,
    ): SlugUniquenessScope | Promise<SlugUniquenessScope>;
}
