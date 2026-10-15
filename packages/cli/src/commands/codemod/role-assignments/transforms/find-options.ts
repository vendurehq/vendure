import {
    ArrayLiteralExpression,
    Expression,
    Node,
    ObjectLiteralElementLike,
    ObjectLiteralExpression,
    SourceFile,
    StringLiteral,
    SyntaxKind,
} from 'ts-morph';

import {
    findCoreEntityInType,
    getRelationTarget,
    isRemovedRelation,
    messageForRemovedRelation,
    Messages,
    walkRelationPath,
} from '../core-entities';
import { FlagCollector } from '../flags';

/** Find options that only filter or sort by a relation; using a removed one there is flagged. */
const FLAGGED_OPTION_KEYS = new Set(['where', 'select', 'order']);

type OptionsRoot = { kind: 'core'; entity: string } | { kind: 'other' } | { kind: 'unknown' };

/**
 * Removes `User.roles` and `Role.channels` from TypeORM and Vendure `relations` options, in both
 * the string form (`['user', 'user.roles']`) and the object form (`{ user: { roles: true } }`).
 * TypeORM throws on a relation the entity does not have, so a leftover path breaks at runtime.
 *
 * The entity is read from the type the options object is checked against, such as
 * `FindOneOptions<Administrator>`, so `user.roles` is only removed where it really reaches a
 * User. Where the type cannot be resolved, a path that looks like a removed relation is flagged
 * instead. `where`, `select` and `order` options that use a removed relation are flagged.
 *
 * Returns the number of relations removed. Flags go to the collector, after the removals.
 */
export function transformFindOptions(sourceFile: SourceFile, flags: FlagCollector): number {
    const removals: Node[] = [];
    for (const { initializer, root } of findOptions(sourceFile, 'relations')) {
        if (root.kind !== 'core') {
            continue;
        }
        if (Node.isArrayLiteralExpression(initializer)) {
            for (const element of getStringElements(initializer)) {
                if (walkRelationPath(root.entity, element.getLiteralText()).kind === 'removed') {
                    removals.push(element);
                }
            }
        } else if (Node.isObjectLiteralExpression(initializer)) {
            walkRelationObject(initializer, root.entity, property => removals.push(property));
        }
    }

    // Last first, so earlier positions stay valid
    for (const node of removals.sort((a, b) => b.getStart() - a.getStart())) {
        const parent = node.getParent();
        if (Node.isArrayLiteralExpression(parent)) {
            parent.removeElement(node as Expression);
        } else if (Node.isPropertyAssignment(node) || Node.isShorthandPropertyAssignment(node)) {
            node.remove();
        }
    }

    for (const { key, initializer, root } of findOptions(sourceFile)) {
        if (key === 'relations' && root.kind === 'unknown') {
            flagUnresolvedRelations(initializer, flags);
        } else if (
            FLAGGED_OPTION_KEYS.has(key) &&
            root.kind === 'core' &&
            Node.isObjectLiteralExpression(initializer)
        ) {
            walkRelationObject(initializer, root.entity, (property, entity) =>
                flags.add(property, messageForRemovedRelation(entity)),
            );
        }
    }

    return removals.length;
}

function findOptions(sourceFile: SourceFile, onlyKey?: string) {
    const results: Array<{ key: string; initializer: Expression; root: OptionsRoot }> = [];
    for (const property of sourceFile.getDescendantsOfKind(SyntaxKind.PropertyAssignment)) {
        const key = property.getName();
        if (onlyKey ? key !== onlyKey : key !== 'relations' && !FLAGGED_OPTION_KEYS.has(key)) {
            continue;
        }
        const options = property.getParentIfKind(SyntaxKind.ObjectLiteralExpression);
        const initializer = property.getInitializer();
        if (options && initializer) {
            results.push({ key, initializer, root: getOptionsRoot(options) });
        }
    }
    return results;
}

function getOptionsRoot(options: ObjectLiteralExpression): OptionsRoot {
    const type = options.getContextualType();
    if (!type || type.isAny() || type.isUnknown()) {
        return { kind: 'unknown' };
    }
    const entity = findCoreEntityInType(type);
    if (entity) {
        return { kind: 'core', entity };
    }
    const typeArguments = [...type.getTypeArguments(), ...type.getAliasTypeArguments()];
    return typeArguments.some(argument => argument.isAny()) ? { kind: 'unknown' } : { kind: 'other' };
}

/**
 * Calls `onRemoved` for each property of a relations-shaped object (`{ user: { roles: true } }`)
 * that is a removed relation, following nested objects through the core relations.
 */
function walkRelationObject(
    object: ObjectLiteralExpression,
    entity: string,
    onRemoved: (property: ObjectLiteralElementLike, entity: string) => void,
) {
    for (const property of object.getProperties()) {
        if (!Node.isPropertyAssignment(property) && !Node.isShorthandPropertyAssignment(property)) {
            continue;
        }
        const name = property.getName();
        if (isRemovedRelation(entity, name)) {
            onRemoved(property, entity);
            continue;
        }
        const target = getRelationTarget(entity, name);
        const initializer = Node.isPropertyAssignment(property) ? property.getInitializer() : undefined;
        if (target && initializer && Node.isObjectLiteralExpression(initializer)) {
            walkRelationObject(initializer, target, onRemoved);
        }
    }
}

function flagUnresolvedRelations(initializer: Expression, flags: FlagCollector) {
    if (Node.isArrayLiteralExpression(initializer)) {
        for (const element of getStringElements(initializer)) {
            if (looksLikeRemovedRelation(element.getLiteralText().split('.'))) {
                flags.add(element, Messages.UnresolvedRelation);
            }
        }
    } else if (Node.isObjectLiteralExpression(initializer)) {
        const visit = (object: ObjectLiteralExpression, path: string[]) => {
            for (const property of object.getProperties()) {
                if (!Node.isPropertyAssignment(property) && !Node.isShorthandPropertyAssignment(property)) {
                    continue;
                }
                const propertyPath = [...path, property.getName()];
                if (looksLikeRemovedRelation(propertyPath)) {
                    flags.add(property, Messages.UnresolvedRelation);
                    continue;
                }
                const nested = Node.isPropertyAssignment(property) ? property.getInitializer() : undefined;
                if (nested && Node.isObjectLiteralExpression(nested)) {
                    visit(nested, propertyPath);
                }
            }
        };
        visit(initializer, []);
    }
}

/**
 * `roles` anywhere in the path, or `channels` right after `role` / `roles`. A bare `channels`
 * is left alone: most channel-aware entities have one.
 */
export function looksLikeRemovedRelation(segments: string[]): boolean {
    return segments.some(
        (segment, i) =>
            segment === 'roles' || (segment === 'channels' && i > 0 && /^roles?$/i.test(segments[i - 1])),
    );
}

function getStringElements(array: ArrayLiteralExpression): StringLiteral[] {
    return array.getElements().filter((element): element is StringLiteral => Node.isStringLiteral(element));
}
