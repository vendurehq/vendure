/**
 * Maps the related entity object(s) of a relation custom field to the value of its `<name>Id` or
 * `<name>Ids` input: the id, or the ids for a list. `null` stays `null`. Returns `undefined` for a
 * list whose value is not an array.
 */
export function toRelationIdValue(
    relationValue: { id?: string } | Array<{ id: string }> | null | undefined,
    list: boolean,
): string | string[] | null | undefined {
    if (relationValue === null) {
        return null;
    }
    if (Array.isArray(relationValue)) {
        return list ? relationValue.map(v => v.id) : undefined;
    }
    return list ? undefined : relationValue?.id;
}
