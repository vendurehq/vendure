/* eslint-disable @typescript-eslint/ban-types */
import { Type } from '@vendure/common/lib/shared-types';
import { getMetadataArgsStorage, Unique } from 'typeorm';

/**
 * Adds a unique constraint on `(languageCode, base)` to every registered translation entity —
 * any entity implementing `Translation<T>`, detected by it declaring both a `languageCode`
 * column and a `base` relation, the two members that interface requires. This enforces at the
 * database level the invariant that a translatable entity has at most one translation per
 * language; the application-level check in `TranslatableSaver` reads existing translations
 * before inserting, so two concurrent updates can both pass it and insert the same language
 * twice (#4884).
 *
 * The constraint is registered dynamically at bootstrap rather than via a `@Unique` decorator
 * on each core translation entity, so translation entities defined by plugins are covered
 * without needing any decorator of their own. An entity that already declares its own
 * `(languageCode, base)` unique constraint is left untouched, which also makes this function
 * idempotent when multiple servers bootstrap in the same process.
 */
export function registerTranslationEntityUniqueConstraints(entities: Array<Type<any>>) {
    const metadataArgsStorage = getMetadataArgsStorage();
    for (const EntityCtor of entities) {
        // Columns and relations may be declared on a parent class, so match metadata
        // against the whole inheritance chain the way TypeORM itself does.
        const chain = getInheritanceChain(EntityCtor);
        const hasLanguageCodeColumn = metadataArgsStorage.columns.some(
            column => chain.includes(column.target) && column.propertyName === 'languageCode',
        );
        const hasBaseRelation = metadataArgsStorage.relations.some(
            relation => chain.includes(relation.target) && relation.propertyName === 'base',
        );
        if (!hasLanguageCodeColumn || !hasBaseRelation) {
            continue;
        }
        const alreadyConstrained = metadataArgsStorage.uniques.some(unique => {
            if (!chain.includes(unique.target)) {
                return false;
            }
            const columns = unique.columns;
            return (
                Array.isArray(columns) &&
                columns.length === 2 &&
                columns.includes('languageCode') &&
                columns.includes('base')
            );
        });
        if (!alreadyConstrained) {
            Unique(['languageCode', 'base'])(EntityCtor);
        }
    }
}

function getInheritanceChain(entity: Type<any>): Array<Function | string> {
    const chain: Array<Function | string> = [];
    let current: Function | null = entity;
    while (current && current !== Object.prototype && current.prototype) {
        chain.push(current);
        current = Object.getPrototypeOf(current);
    }
    return chain;
}
