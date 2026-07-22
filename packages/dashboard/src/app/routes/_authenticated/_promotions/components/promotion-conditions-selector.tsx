import { ConfigurableOperationMultiSelector } from '@/vdb/components/shared/configurable-operation-multi-selector.js';
import { configurableOperationDefFragment } from '@/vdb/graphql/fragments.js';
import { graphql } from '@/vdb/graphql/graphql.js';
import { useLingui } from '@lingui/react/macro';
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
    const { t } = useLingui();
    return (
        <ConfigurableOperationMultiSelector
            value={value}
            onChange={onChange}
            queryDocument={promotionConditionsDocument}
            queryKey="promotionConditions"
            dataPath="promotionConditions"
            buttonText={t`Add condition`}
            dropdownTitle={t`Available Conditions`}
            showEnhancedDropdown={true}
            onValidityChange={onValidityChange}
        />
    );
}
