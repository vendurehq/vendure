import { ConfigurableOperationMultiSelector } from '@/vdb/components/shared/configurable-operation-multi-selector.js';
import { configurableOperationDefFragment } from '@/vdb/graphql/fragments.js';
import { graphql } from '@/vdb/graphql/graphql.js';
import { useLingui } from '@lingui/react/macro';
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
    const { t } = useLingui();
    return (
        <ConfigurableOperationMultiSelector
            value={value}
            onChange={onChange}
            queryDocument={promotionActionsDocument}
            queryKey="promotionActions"
            dataPath="promotionActions"
            buttonText={t`Add action`}
            dropdownTitle={t`Available Actions`}
            showEnhancedDropdown={true}
            onValidityChange={onValidityChange}
        />
    );
}
