import { ConfigurableOperationMultiSelector } from '@/vdb/components/shared/configurable-operation-multi-selector.js';
import { ConfigurableOperationInput as ConfigurableOperationInputType } from '@vendure/common/lib/generated-types';
import { getCollectionFiltersQueryOptions } from '../collections.graphql.js';

export interface CollectionFiltersSelectorProps {
    value: ConfigurableOperationInputType[];
    onChange: (filters: ConfigurableOperationInputType[]) => void;
    onValidityChange?: (isValid: boolean) => void;
}

export function CollectionFiltersSelector({
    value,
    onChange,
    onValidityChange,
}: Readonly<CollectionFiltersSelectorProps>) {
    return (
        <div className="mt-4">
            <ConfigurableOperationMultiSelector
                value={value}
                onChange={onChange}
                queryOptions={getCollectionFiltersQueryOptions}
                queryKey="getCollectionFilters"
                dataPath="collectionFilters"
                buttonText="Add collection filter"
                showEnhancedDropdown={false}
                onValidityChange={onValidityChange}
            />
        </div>
    );
}
