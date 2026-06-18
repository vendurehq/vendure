/**
 * Maps filter fields to their corresponding ID fields in faceted filters.
 * For example, transforms { category: '5' } to { categoryId: { eq: '5' } }
 *
 * @param facetedFilters - Array of filter objects to transform
 * @param fieldMapping - Record mapping source field names to target field names
 */
export function mapFacetedFilterFields(
    facetedFilters: Array<Record<string, any>>,
    fieldMapping: Record<string, string>,
) {
    for (const [index, filter] of Object.entries(facetedFilters)) {
        for (const [sourceField, targetField] of Object.entries(fieldMapping)) {
            if (filter[sourceField]) {
                facetedFilters[index as unknown as number] = {
                    [targetField]: filter[sourceField],
                };
            }
        }
    }
}
