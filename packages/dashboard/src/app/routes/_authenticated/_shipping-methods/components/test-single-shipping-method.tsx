import { Accordion } from '@/vdb/components/ui/accordion.js';
import { api } from '@/vdb/graphql/api.js';
import { useQuery } from '@tanstack/react-query';
import { VariablesOf } from 'gql.tada';
import { testShippingMethodDocument } from '../shipping-methods.graphql.js';
import { TestAddressForm } from './test-address-form.js';
import { TestOrderBuilder } from './test-order-builder.js';
import { TestSingleMethodResult } from './test-single-method-result.js';
import { useShippingMethodTestState } from './use-shipping-method-test-state.js';

interface TestSingleShippingMethodProps {
    checker: VariablesOf<typeof testShippingMethodDocument>['input']['checker'];
    calculator: VariablesOf<typeof testShippingMethodDocument>['input']['calculator'];
}

export function TestSingleShippingMethod({ checker, calculator }: Readonly<TestSingleShippingMethodProps>) {
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
        queryKey: ['testShippingMethod', testAddress, testOrderLines, checker, calculator],
        queryFn: async () => {
            if (!testAddress || !testOrderLines.length) {
                return { testShippingMethod: undefined };
            }
            return api.query(testShippingMethodDocument, {
                input: {
                    shippingAddress: testAddress,
                    lines: testOrderLines.map(l => ({
                        productVariantId: l.id,
                        quantity: l.quantity,
                    })),
                    checker,
                    calculator,
                },
            });
        },
        enabled: false,
    });

    const testResult = data?.testShippingMethod;

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

            <TestSingleMethodResult
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
