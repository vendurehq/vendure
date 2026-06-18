import { ConfigurableOperationMultiSelector } from '@/vdb/components/shared/configurable-operation-multi-selector.js';
import { configurableOperationDefFragment } from '@/vdb/graphql/fragments.js';
import { graphql } from '@/vdb/graphql/graphql.js';
import { ConfigurableOperationInput as ConfigurableOperationInputType } from '@vendure/common/lib/generated-types';

export const promotionConditionsDocument = graphql(
    `
        query GetPromotionConditions {
            promotionConditions {
                ...ConfigurableOperationDef
            }
        }
    `,
    [configurableOperationDefFragment],
);

interface PromotionConditionsSelectorProps {
    value: ConfigurableOperationInputType[];
    onChange: (value: ConfigurableOperationInputType[]) => void;
    onValidityChange?: (isValid: boolean) => void;
}

export function PromotionConditionsSelector({
    value,
    onChange,
    onValidityChange,
}: Readonly<PromotionConditionsSelectorProps>) {
    return (
        <ConfigurableOperationMultiSelector
            value={value}
            onChange={onChange}
            queryDocument={promotionConditionsDocument}
            queryKey="promotionConditions"
            dataPath="promotionConditions"
            buttonText="Add condition"
            dropdownTitle="Available Conditions"
            showEnhancedDropdown={true}
            onValidityChange={onValidityChange}
        />
    );
}
