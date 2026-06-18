import { useLingui } from '@lingui/react/macro';
import { PlusIcon } from 'lucide-react';

import { Button } from '@/vdb/components/ui/button.js';
import {
    DropdownMenu,
    DropdownMenuContent,
    DropdownMenuItem,
    DropdownMenuTrigger,
} from '@/vdb/components/ui/dropdown-menu.js';
import { ResultOf } from 'gql.tada';

import { stockLocationsQueryDocument } from '../product-variants.graphql.js';

interface AddStockLocationDropdownProps {
    availableStockLocations: ResultOf<typeof stockLocationsQueryDocument>['stockLocations']['items'];
    usedStockLocationIds: string[];
    onStockLocationSelect: (stockLocationId: string, stockLocationName: string) => void;
    placeholder?: string;
}

export function AddStockLocationDropdown({
    availableStockLocations,
    usedStockLocationIds,
    onStockLocationSelect,
    placeholder,
}: AddStockLocationDropdownProps) {
    const { t } = useLingui();

    const unusedStockLocations = availableStockLocations.filter(sl => !usedStockLocationIds.includes(sl.id));

    if (unusedStockLocations.length === 0) {
        return null;
    }

    return (
        <DropdownMenu>
            <DropdownMenuTrigger render={<Button variant="outline" className="gap-2" />}>
                <PlusIcon className="size-4" />
                {placeholder || t`Add stock level for another location`}
            </DropdownMenuTrigger>
            <DropdownMenuContent>
                {unusedStockLocations.map(location => (
                    <DropdownMenuItem
                        key={location.id}
                        onClick={() => onStockLocationSelect(location.id, location.name)}
                    >
                        {location.name}
                    </DropdownMenuItem>
                ))}
            </DropdownMenuContent>
        </DropdownMenu>
    );
}
