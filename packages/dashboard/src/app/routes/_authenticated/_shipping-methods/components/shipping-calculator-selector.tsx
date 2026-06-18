import { ConfigurableOperationSelector } from '@/vdb/components/shared/configurable-operation-selector.js';
import { configurableOperationDefFragment } from '@/vdb/graphql/fragments.js';
import { graphql } from '@/vdb/graphql/graphql.js';
import { ConfigurableOperationInput as ConfigurableOperationInputType } from '@vendure/common/lib/generated-types';

export const shippingCalculatorsDocument = graphql(
    `
        query GetShippingCalculators {
            shippingCalculators {
                ...ConfigurableOperationDef
            }
        }
    `,
    [configurableOperationDefFragment],
);

interface ShippingCalculatorSelectorProps {
    value: ConfigurableOperationInputType | undefined;
    onChange: (value: ConfigurableOperationInputType | undefined) => void;
    onValidityChange?: (isValid: boolean) => void;
}

export function ShippingCalculatorSelector({
    value,
    onChange,
    onValidityChange,
}: Readonly<ShippingCalculatorSelectorProps>) {
    return (
        <ConfigurableOperationSelector
            value={value}
            onChange={onChange}
            queryDocument={shippingCalculatorsDocument}
            queryKey="shippingCalculators"
            dataPath="shippingCalculators"
            buttonText="Select Shipping Calculator"
            onValidityChange={onValidityChange}
        />
    );
}
