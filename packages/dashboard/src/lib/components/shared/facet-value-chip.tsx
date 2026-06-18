import { Badge } from '@/vdb/components/ui/badge.js';
import { X } from 'lucide-react';

// Interface for facet value type
interface FacetValue {
    id: string;
    name: string;
    code: string;
    facet: {
        id: string;
        name: string;
        code: string;
    };
}

interface FacetValueChipProps {
    facetValue: FacetValue;
    removable?: boolean;
    displayFacetName?: boolean;
    onRemove?: (id: string) => void;
}

/**
 * @description
 * A component for displaying a facet value as a chip.
 *
 * @docsCategory components
 * @since 3.4.0
 */
export function FacetValueChip({
    facetValue,
    removable = true,
    onRemove,
    displayFacetName = true,
}: FacetValueChipProps) {
    return (
        <Badge
            variant="secondary"
            className="flex items-center gap-2 py-0.5 pl-2 pr-1 h-6 max-w-full shrink hover:bg-secondary/80"
        >
            <div className="flex items-center gap-1.5 min-w-0 truncate">
                <span className="font-medium truncate" title={facetValue.name}>{facetValue.name}</span>
                {displayFacetName && (
                    <span className="text-muted-foreground text-xs truncate" title={facetValue.facet.name}>in {facetValue.facet.name}</span>
                )}
            </div>
            {removable && (
                <button
                    type="button"
                    className="ml-0.5 inline-flex h-4 w-4 shrink-0 items-center justify-center rounded-full hover:bg-muted/30"
                    onClick={() => onRemove?.(facetValue.id)}
                    aria-label={`Remove ${facetValue.name} from ${facetValue.facet.name}`}
                >
                    <X className="h-3 w-3" />
                </button>
            )}
        </Badge>
    );
}
