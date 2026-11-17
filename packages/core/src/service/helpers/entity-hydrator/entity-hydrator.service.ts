import { Injectable } from '@nestjs/common';
import { Type } from '@vendure/common/lib/shared-types';
import { unique } from '@vendure/common/lib/unique';
import { SelectQueryBuilder } from 'typeorm';

import { RequestContext } from '../../../api/common/request-context';
import { InternalServerError } from '../../../common/error/errors';
import { findOptionsArrayToObject } from '../../../connection/find-options-array-to-object';
import { TransactionalConnection } from '../../../connection/transactional-connection';
import { VendureEntity } from '../../../entity/base/base.entity';
import { ProductVariant } from '../../../entity/product-variant/product-variant.entity';
import { ProductPriceApplicator } from '../product-price-applicator/product-price-applicator';
import { TranslatorService } from '../translator/translator.service';
import { joinTreeRelationsDynamically } from '../utils/tree-relations-qb-joiner';

import { HydrateOptions } from './entity-hydrator-types';
import { mergeDeep } from './merge-deep';

/**
 * @description
 * This is a helper class which is used to "hydrate" entity instances, which means to populate them
 * with the specified relations. This is useful when writing plugin code which receives an entity,
 * and you need to ensure that one or more relations are present.
 *
 * @example
 * ```ts
 * import { Injectable } from '\@nestjs/common';
 * import { ID, RequestContext, EntityHydrator, ProductVariantService } from '\@vendure/core';
 *
 * \@Injectable()
 * export class MyService {
 *
 *   constructor(
 *      private entityHydrator: EntityHydrator, // [!code highlight]
 *      private productVariantService: ProductVariantService,
 *   ) {}
 *
 *   myMethod(ctx: RequestContext, variantId: ID) {
 *     const product = await this.productVariantService
 *       .getProductForVariant(ctx, variantId);
 *
 *     // at this stage, we don't know which of the Product relations
 *     // will be joined at runtime.
 *
 *     await this.entityHydrator // [!code highlight]
 *       .hydrate(ctx, product, { relations: ['facetValues.facet' ]}); // [!code highlight]
 *
 *     // You can be sure now that the `facetValues` & `facetValues.facet` relations are populated // [!code highlight]
 *   }
 * }
 *```
 *
 * In this above example, the `product` instance will now have the `facetValues` relation
 * available, and those FacetValues will have their `facet` relations joined too.
 *
 * This `hydrate` method will _also_ automatically take care or translating any
 * translatable entities (e.g. Product, Collection, Facet), and if the `applyProductVariantPrices`
 * options is used (see {@link HydrateOptions}), any related ProductVariant will have the correct
 * Channel-specific prices applied to them.
 *
 * Custom field relations may also be hydrated:
 *
 * @example
 * ```ts
 * const customer = await this.customerService
 *   .findOne(ctx, id);
 *
 * await this.entityHydrator
 *   .hydrate(ctx, customer, { relations: ['customFields.avatar' ]});
 * ```
 *
 * @docsCategory data-access
 * @since 1.3.0
 */
@Injectable()
export class EntityHydrator {
    constructor(
        private connection: TransactionalConnection,
        private productPriceApplicator: ProductPriceApplicator,
        private translator: TranslatorService,
    ) {}

    /**
     * @description
     * Hydrates (joins) the specified relations to the target entity instance. This method
     * mutates the `target` entity.
     *
     * @example
     * ```ts
     * await this.entityHydrator.hydrate(ctx, product, {
     *   relations: [
     *     'variants.stockMovements'
     *     'optionGroups.options',
     *     'featuredAsset',
     *   ],
     *   applyProductVariantPrices: true,
     * });
     * ```
     *
     * @since 1.3.0
     */
    async hydrate<Entity extends VendureEntity>(
        ctx: RequestContext,
        target: Entity,
        options: HydrateOptions<Entity>,
    ): Promise<Entity> {
        if (options.relations) {
            let missingRelations = this.getMissingRelations(target, options);

            if (options.applyProductVariantPrices === true) {
                const productVariantPriceRelations = this.getRequiredProductVariantRelations(
                    target,
                    missingRelations,
                );
                missingRelations = unique([...missingRelations, ...productVariantPriceRelations]);
            }

            // Add .translations relations for translatable entities
            // Note: For nested relations through arrays (like assets.asset), we rely on eager loading
            // on the Asset.translations relation since explicitly loading deeply nested relations
            // can cause issues with TypeORM's relation loading
            const translationRelations = this.getTranslationRelationsForTranslatableEntities(
                target,
                missingRelations,
            );
            missingRelations = unique([...missingRelations, ...translationRelations]);

            if (missingRelations.length) {
                const hydratedQb: SelectQueryBuilder<any> = this.connection
                    .getRepository(ctx, target.constructor)
                    .createQueryBuilder(target.constructor.name);
                const joinedRelations = joinTreeRelationsDynamically(
                    hydratedQb,
                    target.constructor,
                    missingRelations,
                );
                hydratedQb.setFindOptions({
                    relationLoadStrategy: 'query',
                    where: { id: target.id },
                    relations: findOptionsArrayToObject(
                        missingRelations.filter(relationPath => !joinedRelations.has(relationPath)),
                    ),
                });
                const hydrated = await hydratedQb.getOne();
                const propertiesToAdd = unique(missingRelations.map(relation => relation.split('.')[0]));
                // Each call starts its own memo, so an entity shared by two top-level relations is
                // merged once per relation. Deliberate: bounded by the relation count. See #5083.
                for (const prop of propertiesToAdd) {
                    (target as any)[prop] = mergeDeep((target as any)[prop], hydrated[prop]);
                }

                const relationsWithEntities = missingRelations.map(relation => ({
                    entity: this.getRelationEntityAtPath(target, relation.split('.')),
                    relation,
                }));

                if (options.applyProductVariantPrices === true) {
                    for (const relationWithEntities of relationsWithEntities) {
                        // Applied sequentially rather than with Promise.all: relation arrays are
                        // unbounded in size, and applyChannelPriceAndTax() is applied per variant
                        // the same way in ProductVariantService.assignProductVariantsToChannel()
                        for (const variant of this.getProductVariantsToPrice(relationWithEntities.entity)) {
                            await this.productPriceApplicator.applyChannelPriceAndTax(variant, ctx);
                        }
                    }
                }

                const translateDeepRelations = relationsWithEntities
                    .filter(item => this.isTranslatable(item.entity))
                    .map(item => item.relation.split('.'));

                this.assignSettableProperties(
                    target,
                    this.translator.translate(target as any, ctx, translateDeepRelations as any),
                );
            }
        }
        return target;
    }

    private assignSettableProperties<Entity extends VendureEntity>(target: Entity, source: Entity) {
        for (const [key, descriptor] of Object.entries(Object.getOwnPropertyDescriptors(target))) {
            if (typeof descriptor.get === 'function' && typeof descriptor.set !== 'function') {
                // If the entity property has a getter only, we will skip it otherwise
                // we will get an error of the form:
                // `Cannot set property <name> of #<Entity> which has only a getter`
                continue;
            }
            target[key as keyof Entity] = source[key as keyof Entity];
        }
        return target;
    }

    /**
     * Compares the requested relations against the actual existing relations on the target entity,
     * and returns an array of all missing relation paths that would need to be fetched.
     */
    private getMissingRelations<Entity extends VendureEntity>(
        target: Entity,
        options: HydrateOptions<Entity>,
    ) {
        const missingRelations: string[] = [];
        for (const relation of options.relations.slice().sort()) {
            if (typeof relation === 'string') {
                const parts = relation.split('.');
                // The entities found at the current depth of the relation path. An array-valued
                // relation can be loaded unevenly, e.g. `order.lines[0].productVariant` is present
                // but `order.lines[1].productVariant` is not, so every entity at a given depth must
                // be checked rather than just the first.
                let entities: Array<Record<string, any>> = [target];
                const path = [];
                let isMissing = false;
                for (const part of parts) {
                    path.push(part);
                    if (!isMissing) {
                        const nextEntities: Array<Record<string, any>> = [];
                        for (const entity of entities) {
                            // undefined = this array element (or relation) was never fetched,
                            // e.g. an `undefined` hole in a relation array, so the rest of the
                            // path must be reported missing rather than skipped.
                            if (entity === undefined) {
                                isMissing = true;
                                break;
                            }
                            // null = the relation has been fetched but was null in the database.
                            if (entity === null || entity[part] === null) {
                                continue;
                            }
                            const value = entity[part];
                            if (!value) {
                                isMissing = true;
                                break;
                            }
                            // At the last segment of the path we only need to know whether the
                            // relation is present; the entities it points to are never inspected,
                            // so there is no point collecting them.
                            const isLastPart = path.length === parts.length;
                            if (Array.isArray(value)) {
                                if (value.length === 0) {
                                    if (!isLastPart) {
                                        // An empty array leaves nothing to check further down the
                                        // path, so treat the rest of the path as missing.
                                        isMissing = true;
                                        break;
                                    }
                                } else if (!isLastPart) {
                                    // Use a plain loop rather than push(...value): spreading a
                                    // very large array (e.g. collections.productVariants on a
                                    // big catalog) exceeds V8's argument limit and throws
                                    // RangeError, even when everything is already loaded.
                                    for (const element of value) {
                                        nextEntities.push(element);
                                    }
                                }
                            } else if (!isLastPart) {
                                nextEntities.push(value);
                            }
                        }
                        entities = nextEntities;
                    }
                    if (isMissing) {
                        const allParts = path.reduce((result, p, i) => {
                            if (i === 0) {
                                return [p];
                            } else {
                                return [...result, [result[result.length - 1], p].join('.')];
                            }
                        }, [] as string[]);
                        missingRelations.push(...allParts);
                    }
                }
            }
        }
        return unique(missingRelations.filter(relation => !relation.endsWith('.customFields')));
    }

    private getRequiredProductVariantRelations<Entity extends VendureEntity>(
        target: Entity,
        missingRelations: string[],
    ): string[] {
        const relationsToAdd: string[] = [];
        for (const relation of missingRelations) {
            const entityType = this.getRelationEntityTypeAtPath(target, relation);
            if (entityType === ProductVariant) {
                relationsToAdd.push([relation, 'taxCategory'].join('.'));
                relationsToAdd.push([relation, 'productVariantPrices'].join('.'));
            }
        }
        return relationsToAdd;
    }

    /**
     * Returns an instance of the related entity at the given path. E.g. a path of `['variants', 'featuredAsset']`
     * will return an Asset instance.
     */
    private getRelationEntityAtPath(
        entity: VendureEntity,
        path: string[],
    ): VendureEntity | VendureEntity[] | undefined {
        let isArrayResult = false;
        const result: VendureEntity[] = [];

        function visit(parent: any, parts: string[]): any {
            if (parts.length === 0) {
                return;
            }
            const part = parts.shift() as string;
            const target = parent[part];
            if (Array.isArray(target)) {
                isArrayResult = true;
                if (parts.length === 0) {
                    // Use a plain loop rather than push(...target): spreading a very large array
                    // (e.g. `collection.productVariants` on a big catalog) expands it into call
                    // arguments, which exceeds V8's stack budget and throws a RangeError. Same
                    // fix as in getMissingRelations() above.
                    for (const item of target) {
                        result.push(item);
                    }
                } else {
                    for (const item of target) {
                        visit(item, parts.slice());
                    }
                }
            } else if (target == null) {
                result.push(target);
            } else {
                if (parts.length === 0) {
                    result.push(target);
                } else {
                    visit(target, parts.slice());
                }
            }
        }
        visit(entity, path.slice());
        return isArrayResult ? result : result[0];
    }

    /**
     * Returns the ProductVariants found at a relation path, to which Channel prices should be
     * applied. A relation array can contain `null`/`undefined` entries — getRelationEntityAtPath()
     * pushes them deliberately — and only some of its elements may be ProductVariants, so the type
     * is tested per element rather than sampled from element [0]. Sampling [0] was wrong in both
     * directions: a hole at [0] suppressed pricing for every real ProductVariant in the array, and
     * a ProductVariant at [0] passed the holes behind it straight into applyChannelPriceAndTax(),
     * which dereferences `variant.productVariantPrices` and throws.
     */
    private getProductVariantsToPrice(entity: VendureEntity | VendureEntity[] | undefined): ProductVariant[] {
        const candidates = Array.isArray(entity) ? entity : [entity];
        return candidates.filter((e): e is ProductVariant => e instanceof ProductVariant);
    }

    private getRelationEntityTypeAtPath(entity: VendureEntity, path: string): Type<VendureEntity> {
        const { entityMetadatas } = this.connection.rawConnection;
        const targetMetadata = entityMetadatas.find(m => m.target === entity.constructor);
        if (!targetMetadata) {
            throw new InternalServerError(
                `Cannot find entity metadata for entity "${entity.constructor.name}"`,
            );
        }
        let currentMetadata = targetMetadata;
        for (const pathPart of path.split('.')) {
            const relationMetadata = currentMetadata.findRelationWithPropertyPath(pathPart);
            if (relationMetadata) {
                currentMetadata = relationMetadata.inverseEntityMetadata;
            } else {
                throw new InternalServerError(
                    `Cannot find relation metadata for entity "${currentMetadata.targetName}" at path "${pathPart}"`,
                );
            }
        }
        return currentMetadata.target as Type<VendureEntity>;
    }

    /**
     * Returns additional .translations relations for any translatable entities in the relations list.
     * This ensures that translatable nested relations have their translations loaded.
     */
    private getTranslationRelationsForTranslatableEntities<Entity extends VendureEntity>(
        target: Entity,
        missingRelations: string[],
    ): string[] {
        const translationRelations: string[] = [];
        for (const relation of missingRelations) {
            try {
                const entityType = this.getRelationEntityTypeAtPath(target, relation);
                // Check if the entity type has a translations property in its metadata
                const { entityMetadatas } = this.connection.rawConnection;
                const entityMetadata = entityMetadatas.find(m => m.target === entityType);
                if (entityMetadata) {
                    const translationsRelation = entityMetadata.findRelationWithPropertyPath('translations');
                    if (translationsRelation) {
                        translationRelations.push(`${relation}.translations`);
                    }
                }
            } catch {
                // If we can't find the entity type, skip this relation
            }
        }
        return translationRelations;
    }

    /**
     * Whether the entity, or any entity of an array-valued relation, is translatable. An array
     * relation can contain `null` (the relation was fetched but is null on that element) or
     * `undefined` (never fetched) entries — getRelationEntityAtPath() deliberately pushes both
     * into its result — so every element must be considered rather than just the first.
     */
    private isTranslatable<T extends VendureEntity>(input: T | T[] | undefined): boolean {
        const hasTranslations = (entity: T | undefined): boolean =>
            entity?.hasOwnProperty('translations') ?? false;
        return Array.isArray(input) ? input.some(hasTranslations) : hasTranslations(input);
    }
}
