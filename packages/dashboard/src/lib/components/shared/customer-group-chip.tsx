import { X } from 'lucide-react';
import { Badge } from '../ui/badge.js';

export function CustomerGroupChip({
    group,
    onRemove,
}: {
    group: { id: string; name: string };
    onRemove?: (id: string) => void;
}) {
    return (
        <Badge
            key={group.id}
            variant="secondary"
            className="flex items-center gap-2 py-0.5 pl-2 pr-1 h-6 hover:bg-secondary/80"
        >
            {group.name}
            {onRemove && (
                <button
                    type="button"
                    className="ml-0.5 inline-flex h-4 w-4 items-center justify-center rounded-full hover:bg-muted/30"
                    onClick={() => onRemove(group.id)}
                    aria-label={`Remove ${group.name}`}
                >
                    <X className="h-3 w-3" />
                </button>
            )}
        </Badge>
    );
}
