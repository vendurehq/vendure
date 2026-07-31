import { ConfigArg, Permission } from '@vendure/common/lib/generated-types';
import { ID } from '@vendure/common/lib/shared-types';

import { RequestContext } from '../../api/common/request-context';
import {
    ConfigArgs,
    ConfigArgValues,
    ConfigurableOperationDef,
    ConfigurableOperationDefOptions,
} from '../../common/configurable-operation';
import { VendureEntity } from '../../entity/base/base.entity';

/**
 * @description
 * A function which performs the duplication of an entity.
 *
 * @docsPage EntityDuplicator
 * @docsCategory configuration
 * @since 2.2.0
 */
export type DuplicateEntityFn<T extends ConfigArgs> = (input: {
    ctx: RequestContext;
    entityName: string;
    id: ID;
    args: ConfigArgValues<T>;
}) => Promise<VendureEntity>;

/**
 * @description
 * Configuration for creating a new EntityDuplicator.
 *
 * @docsPage EntityDuplicator
 * @docsCategory configuration
 * @since 2.2.0
 */
export interface EntityDuplicatorConfig<T extends ConfigArgs> extends ConfigurableOperationDefOptions<T> {
    /**
     * @description
     * The permissions required in order to execute this duplicator. If an array is passed,
     * then the administrator must have at least one of the permissions in the array.
     */
    requiresPermission: Array<Permission | string> | Permission | string;
    /**
     * @description
     * The entities for which this duplicator is able to duplicate.
     */
    forEntities: string[];
    /**
     * @description
     * The function which performs the duplication.
     *
     * @example
     * ```ts
     * duplicate: async input => {
     *   const { ctx, id, args } = input;
     *
     *   // perform the duplication logic here
     *
     *   return newEntity;
     * }
     * ```
     */
    duplicate: DuplicateEntityFn<T>;
}

/**
 * @description
 * An EntityDuplicator is used to define the logic for duplicating entities when the `duplicateEntity` mutation is called.
 * This allows you to add support for duplication of both core and custom entities.
 *
 * @example
 * ```ts title=src/config/custom-collection-duplicator.ts
 * import { Collection, LanguageCode, Permission
 *   EntityDuplicator, TransactionalConnection, CollectionService } from '\@vendure/core';
 *
 * let collectionService: CollectionService;
 * let connection: TransactionalConnection;
 *
 * // This is just an example - we already ship with a built-in duplicator for Collections.
 * const customCollectionDuplicator = new EntityDuplicator({
 *     code: 'custom-collection-duplicator',
 *     description: [{ languageCode: LanguageCode.en, value: 'Custom collection duplicator' }],
 *     args: {
 *         throwError: {
 *             type: 'boolean',
 *             defaultValue: false,
 *         },
 *     },
 *     forEntities: ['Collection'],
 *     requiresPermission: [Permission.UpdateCollection],
 *     init(injector) {
 *         collectionService = injector.get(CollectionService);
 *         connection = injector.get(TransactionalConnection);
 *     },
 *     duplicate: async input => {
 *         const { ctx, id, args } = input;
 *
 *         const original = await connection.getEntityOrThrow(ctx, Collection, id, {
 *             relations: {
 *                 assets: true,
 *                 featuredAsset: true,
 *             },
 *         });
 *         const newCollection = await collectionService.create(ctx, {
 *             isPrivate: original.isPrivate,
 *             customFields: original.customFields,
 *             assetIds: original.assets.map(a => a.id),
 *             featuredAssetId: original.featuredAsset?.id,
 *             parentId: original.parentId,
 *             filters: original.filters.map(f => ({
 *                 code: f.code,
 *                 arguments: f.args,
 *             })),
 *             inheritFilters: original.inheritFilters,
 *             translations: original.translations.map(t => ({
 *                 languageCode: t.languageCode,
 *                 name: `${t.name} (copy)`,
 *                 slug: `${t.slug}-copy`,
 *                 description: t.description,
 *                 customFields: t.customFields,
 *             })),
 *         });
 *
 *         if (args.throwError) {
 *             // If an error is thrown at any point during the duplication process, the entire
 *             // transaction will get automatically rolled back, and the mutation will return
 *             // an ErrorResponse containing the error message.
 *             throw new Error('Dummy error');
 *         }
 *
 *         return newCollection;
 *     },
 * });
 * ```
 *
 * The duplicator then gets passed to your VendureConfig object:
 *
 * ```ts title=src/vendure-config.ts
 * import { VendureConfig, defaultEntityDuplicators } from '\@vendure/core';
 * import { customCollectionDuplicator } from './config/custom-collection-duplicator';
 *
 * export const config: VendureConfig = {
 *    // ...
 *    entityOptions: {
 *      entityDuplicators: [
 *          ...defaultEntityDuplicators,
 *          customCollectionDuplicator,
 *      ],
 *    },
 * };
 * ```
 *
 * @docsPage EntityDuplicator
 * @docsWeight 0
 * @docsCategory configuration
 * @since 2.2.0
 */
export class EntityDuplicator<T extends ConfigArgs = ConfigArgs> extends ConfigurableOperationDef<T> {
    private _forEntities: string[];
    private _requiresPermission: Array<Permission | string> | Permission | string;
    private duplicateFn: DuplicateEntityFn<T>;

    /** @internal */
    canDuplicate(entityName: string): boolean {
        return this._forEntities.includes(entityName);
    }

    /** @internal */
    get forEntities() {
        return this._forEntities;
    }

    /** @internal */
    get requiresPermission(): Permission[] {
        return (Array.isArray(this._requiresPermission)
            ? this._requiresPermission
            : [this._requiresPermission]) as any as Permission[];
    }

    constructor(config: EntityDuplicatorConfig<T>) {
        super(config);
        this._forEntities = config.forEntities;
        this._requiresPermission = config.requiresPermission;
        this.duplicateFn = config.duplicate;
    }

    duplicate(input: {
        ctx: RequestContext;
        entityName: string;
        id: ID;
        args: ConfigArg[];
    }): Promise<VendureEntity> {
        return this.duplicateFn({
            ...input,
            args: this.argsArrayToHash(input.args),
        });
    }
}
