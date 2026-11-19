import { Chip } from '../ui/chip.js';

export function CustomerGroupChip({
    group,
    onRemove,
}: {
    group: { id: string; name: string };
    onRemove?: (id: string) => void;
}) {
    return (
        <Chip
            onRemove={onRemove ? () => onRemove(group.id) : undefined}
            removeLabel={`Remove ${group.name}`}
        >
            {group.name}
        </Chip>
    );
}
