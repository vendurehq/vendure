import { getBulkActions } from '@/vdb/framework/data-table/data-table-extensions.js';
import { BulkAction, BulkActionGroup, BulkActionsInput } from '@/vdb/framework/extension-api/types/index.js';
import { usePageBlock } from '@/vdb/hooks/use-page-block.js';
import { usePage } from '@/vdb/hooks/use-page.js';

/**
 * Normalizes bulk actions input into an array of `BulkActionGroup`.
 *
 * Supports three input formats:
 * 1. Flat `BulkAction[]` → single group
 * 2. `BulkAction[][]` → one group per inner array
 * 3. `BulkActionGroup[]` → used as-is (can be mixed with plain arrays)
 */
export function normalizeBulkActions(input?: BulkActionsInput): BulkActionGroup[] {
    if (!input || input.length === 0) return [];

    const first = input[0];

    // Flat BulkAction[] — has `component` on the first element
    if (first != null && 'component' in first) {
        return [{ actions: input as BulkAction[] }];
    }

    // Grouped: each element is either BulkAction[] or BulkActionGroup
    return (input as Array<BulkAction[] | BulkActionGroup>).map(group => {
        if (Array.isArray(group)) {
            return { actions: group };
        }
        return group;
    });
}

/**
 * @description
 * Augments the provided Bulk Actions with any user-defined actions for the current
 * page & block, and returns all of the bulk action groups sorted by the `order` property.
 */
export function useAllBulkActions(bulkActions: BulkActionsInput): BulkActionGroup[] {
    const { pageId } = usePage();
    const pageBlock = usePageBlock();
    const blockId = pageBlock?.blockId;
    const extendedBulkActions = pageId ? getBulkActions(pageId, blockId) : [];

    let groups = normalizeBulkActions(bulkActions);

    // Merge extension bulk actions into the first group
    if (extendedBulkActions.length > 0) {
        if (groups.length > 0) {
            groups = [
                { ...groups[0], actions: [...extendedBulkActions, ...groups[0].actions] },
                ...groups.slice(1),
            ];
        } else {
            groups = [{ actions: extendedBulkActions }];
        }
    }

    // Sort actions within each group by order
    return groups.map(group => ({
        ...group,
        actions: [...group.actions].sort((a, b) => (a.order ?? 10_000) - (b.order ?? 10_000)),
    }));
}
