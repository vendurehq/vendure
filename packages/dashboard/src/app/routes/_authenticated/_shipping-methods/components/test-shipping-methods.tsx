import { Accordion } from '@/vdb/components/ui/accordion.js';
import { api } from '@/vdb/graphql/api.js';
import { useQuery } from '@tanstack/react-query';
import { testEligibleShippingMethodsDocument } from '../shipping-methods.graphql.js';
import { TestAddressForm } from './test-address-form.js';
import { TestOrderBuilder } from './test-order-builder.js';
import { TestShippingMethodsResult } from './test-shipping-methods-result.js';
import { useShippingMethodTestState } from './use-shipping-method-test-state.js';

export function TestShippingMethods() {
    const {
        testAddress,
        testOrderLines,
        testDataUpdated,
        hasTestedOnce,
        expandedAccordions,
        setExpandedAccordions,
        allTestDataPresent,
        handleAddressChange,
        handleOrderLinesChange,
        markTestRun,
    } = useShippingMethodTestState();

    const { data, isLoading, refetch } = useQuery({
        queryKey: ['testEligibleShippingMethods', testAddress, testOrderLines],
        queryFn: async () => {
            if (!testAddress || !testOrderLines.length) {
                return { testEligibleShippingMethods: [] };
            }
            return api.query(testEligibleShippingMethodsDocument, {
                input: {
                    shippingAddress: testAddress,
                    lines: testOrderLines.map(l => ({
                        productVariantId: l.id,
                        quantity: l.quantity,
                    })),
                },
            });
        },
        enabled: false,
    });

    const testResult = data?.testEligibleShippingMethods || [];

    const runTest = () => {
        if (allTestDataPresent) {
            markTestRun();
            refetch();
        }
    };

    return (
        <div className="space-y-6 overflow-y-auto max-h-[calc(100vh-200px)] px-4">
            <Accordion
                value={expandedAccordions}
                onValueChange={setExpandedAccordions}
                className="w-full"
            >
                <TestOrderBuilder onOrderLinesChange={handleOrderLinesChange} />
                <TestAddressForm onAddressChange={handleAddressChange} />
            </Accordion>

            <TestShippingMethodsResult
                testResult={testResult}
                okToRun={allTestDataPresent}
                testDataUpdated={testDataUpdated}
                hasTestedOnce={hasTestedOnce}
                onRunTest={runTest}
                loading={isLoading}
            />
        </div>
    );
}
