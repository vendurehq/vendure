import { ConfigurableOperationSelector } from '@/vdb/components/shared/configurable-operation-selector.js';
import { configurableOperationDefFragment } from '@/vdb/graphql/fragments.js';
import { graphql } from '@/vdb/graphql/graphql.js';
import { ConfigurableOperationInput as ConfigurableOperationInputType } from '@vendure/common/lib/generated-types';

export const paymentHandlersDocument = graphql(
    `
        query GetPaymentHandlers {
            paymentMethodHandlers {
                ...ConfigurableOperationDef
            }
        }
    `,
    [configurableOperationDefFragment],
);

interface PaymentHandlerSelectorProps {
    value: ConfigurableOperationInputType | undefined;
    onChange: (value: ConfigurableOperationInputType | undefined) => void;
    onValidityChange?: (isValid: boolean) => void;
}

export function PaymentHandlerSelector({
    value,
    onChange,
    onValidityChange,
}: Readonly<PaymentHandlerSelectorProps>) {
    return (
        <ConfigurableOperationSelector
            value={value}
            onChange={onChange}
            queryDocument={paymentHandlersDocument}
            queryKey="paymentMethodHandlers"
            dataPath="paymentMethodHandlers"
            buttonText="Select Payment Handler"
            onValidityChange={onValidityChange}
        />
    );
}
