import { ConfigurableOperationMultiSelector } from '@/vdb/components/shared/configurable-operation-multi-selector.js';
import { configurableOperationDefFragment } from '@/vdb/graphql/fragments.js';
import { graphql } from '@/vdb/graphql/graphql.js';
import { ConfigurableOperationInput as ConfigurableOperationInputType } from '@vendure/common/lib/generated-types';

export const promotionActionsDocument = graphql(
    `
        query GetPromotionActions {
            promotionActions {
                ...ConfigurableOperationDef
            }
        }
    `,
    [configurableOperationDefFragment],
);

interface PromotionActionsSelectorProps {
    value: ConfigurableOperationInputType[];
    onChange: (value: ConfigurableOperationInputType[]) => void;
    onValidityChange?: (isValid: boolean) => void;
}

export function PromotionActionsSelector({
    value,
    onChange,
    onValidityChange,
}: Readonly<PromotionActionsSelectorProps>) {
    return (
        <ConfigurableOperationMultiSelector
            value={value}
            onChange={onChange}
            queryDocument={promotionActionsDocument}
            queryKey="promotionActions"
            dataPath="promotionActions"
            buttonText="Add action"
            dropdownTitle="Available Actions"
            showEnhancedDropdown={true}
            onValidityChange={onValidityChange}
        />
    );
}
