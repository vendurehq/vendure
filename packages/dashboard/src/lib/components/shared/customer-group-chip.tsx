import { Chip, type ChipRemoveProps } from '../ui/chip.js';

export function CustomerGroupChip({
    group,
    onRemove,
}: {
    group: { id: string; name: string };
    onRemove?: (id: string) => void;
}) {
    const removeProps: ChipRemoveProps = onRemove
        ? { onRemove: () => onRemove(group.id), removeLabel: `Remove ${group.name}` }
        : {};
    return <Chip {...removeProps}>{group.name}</Chip>;
}
