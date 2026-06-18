import { SelectQueryBuilder } from 'typeorm';

import { Logger } from '../config/logger/vendure-logger';

/**
 * This is a work-around for this issue: https://github.com/vendurehq/vendure/issues/1664
 *
 * Explanation:
 * When calling `FindOptionsUtils.joinEagerRelations()`, there appears to be a bug in TypeORM whereby
 * it will throw the following error *if* the `options.relations` array contains any customField relations
 * where the related entity itself has eagerly-loaded relations.
 *
 * For example, let's say we define a custom field on the Product entity like this:
 * ```
 * Product: [{
 *   name: 'featuredFacet',
 *   type: 'relation',
 *   entity: Facet,
 * }],
 * ```
 * and then we pass into `TransactionalConnection.findOneInChannel()` an options array of:
 *
 * ```
 * { relations: ['customFields.featuredFacet'] }
 * ```
 * it will throw an error because the `Facet` entity itself has eager relations (namely the `translations` property).
 * This will cause TypeORM to throw the error:
 * ```
 * TypeORMError: "entity__customFields" alias was not found. Maybe you forgot to join it?
 * ```
 *
 * So this method introspects the QueryBuilder metadata and checks for any custom field relations which
 * themselves have eager relations. If found, it removes those items from the `options.relations` array.
 *
 * TODO: Ideally create a minimal reproduction case and report in the TypeORM repo for an upstream fix.
 */

export function removeCustomFieldsWithEagerRelations<T extends string>(
    qb: SelectQueryBuilder<any>,
    relations: T[] = [],
): T[] {
    let resultingRelations = relations;
    const mainAlias = qb.expressionMap.mainAlias;
    const customFieldsMetadata = mainAlias?.metadata.embeddeds.find(
        metadata => metadata.propertyName === 'customFields',
    );
    if (customFieldsMetadata) {
        const customFieldRelationsWithEagerRelations = customFieldsMetadata.relations.filter(relation => {
            return (
                !!relation.inverseEntityMetadata.ownRelations.find(or => or.isEager === true) ||
                relation.inverseEntityMetadata.embeddeds.find(
                    em => em.propertyName === 'customFields' && em.relations.find(emr => emr.isEager),
                )
            );
        });
        for (const relation of customFieldRelationsWithEagerRelations) {
            const propertyName = relation.propertyName;
            const relationsToRemove = relations.filter(r => r.startsWith(`customFields.${propertyName}`));
            if (relationsToRemove.length) {
                Logger.debug(
                    `TransactionalConnection.findOneInChannel cannot automatically join relation [${
                        mainAlias?.metadata.name ?? '(unknown)'
                    }.customFields.${propertyName}]`,
                );
                resultingRelations = relations.filter(r => !r.startsWith(`customFields.${propertyName}`));
            }
        }
    }
    return resultingRelations;
}
