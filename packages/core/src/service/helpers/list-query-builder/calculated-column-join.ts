/**
 * The join required by a relation listed on a calculated column's `listQuery` instruction.
 */
export interface CalculatedColumnJoin {
    propertyPath: string;
    alias: string;
    joinType: 'left' | 'inner';
}

/**
 * Resolves the property path, alias and join type for a relation which a calculated column
 * expression depends on.
 *
 * TypeORM joins eager relations under `<entityAlias>__<relation>`. An expression written
 * against that alias is embedded into the SQL verbatim, so the join has to be created under
 * that exact name, and with a LEFT JOIN to match how the eager join would have behaved.
 * Otherwise the relation is joined under its own name with an INNER JOIN.
 */
export function resolveCalculatedColumnJoin(
    entityAlias: string,
    relation: string,
    expression?: string,
): CalculatedColumnJoin {
    const isNestedPath = relation.includes('.');
    const propertyPath = isNestedPath ? relation : `${entityAlias}.${relation}`;
    const baseAlias = isNestedPath ? relation.split('.').reverse()[0] : relation;
    const expressionAlias = expression?.match(/^(\w+)\.\w+/)?.[1];
    const eagerStyleAlias = `${entityAlias}__${baseAlias}`;
    const usesEagerStyleAlias =
        expressionAlias != null && expressionAlias.toLowerCase() === eagerStyleAlias.toLowerCase();

    return {
        propertyPath,
        alias: usesEagerStyleAlias ? expressionAlias : baseAlias,
        joinType: usesEagerStyleAlias ? 'left' : 'inner',
    };
}
