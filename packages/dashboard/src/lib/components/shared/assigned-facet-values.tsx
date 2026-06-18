import { useState } from 'react';
import { FacetValueChip } from './facet-value-chip.js';
import { FacetValueSelector } from './facet-value-selector.js';

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

interface AssignedFacetValuesProps {
    value?: string[] | null;
    facetValues: FacetValue[];
    canUpdate?: boolean;
    onChange?: (value: string[]) => void;
}

export function AssignedFacetValues({
    value = [],
    facetValues,
    canUpdate = true,
    onChange,
}: Readonly<AssignedFacetValuesProps>) {
    const [knownFacetValues, setKnownFacetValues] = useState<FacetValue[]>(facetValues);

    function onSelectHandler(facetValue: FacetValue) {
        setKnownFacetValues(prev => [...prev, facetValue]);
        onChange?.([...new Set([...(value ?? []), facetValue.id])]);
    }

    function onRemoveHandler(id: string) {
        onChange?.(value?.filter(fvId => fvId !== id) ?? []);
    }

    return (
        <>
            <div className="flex flex-wrap">
                {(value ?? []).map(id => {
                    const facetValue = knownFacetValues.find(fv => fv.id === id);
                    if (!facetValue) return null;
                    return (
                        <div className="mb-2 mr-1 max-w-full" key={facetValue.id}>
                            <FacetValueChip
                                facetValue={facetValue}
                                removable={canUpdate}
                                onRemove={onRemoveHandler}
                            />
                        </div>
                    );
                })}
            </div>
            {canUpdate && <FacetValueSelector onValueSelect={onSelectHandler} />}
        </>
    );
}
