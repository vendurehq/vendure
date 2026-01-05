import { ConfigurableOperationSelector } from '@/vdb/components/shared/configurable-operation-selector.js';
import { configurableOperationDefFragment } from '@/vdb/graphql/fragments.js';
import { graphql } from '@/vdb/graphql/graphql.js';
import { useLingui } from '@lingui/react/macro';
import { ConfigurableOperationInput as ConfigurableOperationInputType } from '@vendure/common/lib/generated-types';

export const paymentEligibilityCheckersDocument = graphql(
    `
        query GetPaymentEligibilityCheckers {
            paymentMethodEligibilityCheckers {
                ...ConfigurableOperationDef
            }
        }
    `,
    [configurableOperationDefFragment],
);

interface PaymentEligibilityCheckerSelectorProps {
    value: ConfigurableOperationInputType | undefined;
    onChange: (value: ConfigurableOperationInputType | undefined) => void;
}

export function PaymentEligibilityCheckerSelector({
    value,
    onChange,
}: PaymentEligibilityCheckerSelectorProps) {
    const { t } = useLingui();
    return (
        <ConfigurableOperationSelector
            value={value}
            onChange={onChange}
            queryDocument={paymentEligibilityCheckersDocument}
            queryKey="paymentMethodEligibilityCheckers"
            dataPath="paymentMethodEligibilityCheckers"
            buttonText={t`Select Payment Eligibility Checker`}
            emptyText={t`No checkers found`}
        />
    );
}
