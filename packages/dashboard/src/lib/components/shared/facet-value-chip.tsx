import { Chip } from '@/vdb/components/ui/chip.js';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/vdb/components/ui/tooltip.js';

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
        <Tooltip>
            <TooltipTrigger
                render={
                    <Chip
                        {...(removable && onRemove
                            ? {
                                  onRemove: () => onRemove(facetValue.id),
                                  removeLabel: `Remove ${facetValue.name} from ${facetValue.facet.name}`,
                              }
                            : { onRemove: undefined })}
                    />
                }
            >
                {facetValue.name}
                {displayFacetName && (
                    <span className="text-muted-foreground"> in {facetValue.facet.name}</span>
                )}
            </TooltipTrigger>
            <TooltipContent>
                {displayFacetName ? `${facetValue.name} in ${facetValue.facet.name}` : facetValue.name}
            </TooltipContent>
        </Tooltip>
    );
}
