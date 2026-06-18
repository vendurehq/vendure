import { useCallback, useState } from 'react';

import { TestAddress } from './test-address-form.js';
import { TestOrderLine } from './test-order-builder.js';

export function useShippingMethodTestState() {
    const [testAddress, setTestAddress] = useState<TestAddress | null>(null);
    const [testOrderLines, setTestOrderLines] = useState<TestOrderLine[]>([]);
    const [testDataUpdated, setTestDataUpdated] = useState(true);
    const [hasTestedOnce, setHasTestedOnce] = useState(false);
    const [expandedAccordions, setExpandedAccordions] = useState<string[]>([
        'test-order',
        'shipping-address',
    ]);
    const [lastTestedAddress, setLastTestedAddress] = useState<TestAddress | null>(null);
    const [lastTestedOrderLines, setLastTestedOrderLines] = useState<TestOrderLine[]>([]);

    const allTestDataPresent = !!(testAddress && testOrderLines && testOrderLines.length > 0);

    const handleAddressChange = useCallback(
        (address: TestAddress) => {
            setTestAddress(address);
            if (hasTestedOnce && JSON.stringify(address) !== JSON.stringify(lastTestedAddress)) {
                setTestDataUpdated(true);
            }
        },
        [hasTestedOnce, lastTestedAddress],
    );

    const handleOrderLinesChange = useCallback(
        (lines: TestOrderLine[]) => {
            setTestOrderLines(lines);
            if (hasTestedOnce && JSON.stringify(lines) !== JSON.stringify(lastTestedOrderLines)) {
                setTestDataUpdated(true);
            }
        },
        [hasTestedOnce, lastTestedOrderLines],
    );

    // runTest now only updates state; actual query logic is handled in the component
    const markTestRun = () => {
        setTestDataUpdated(false);
        setHasTestedOnce(true);
        setLastTestedAddress(testAddress);
        setLastTestedOrderLines(testOrderLines);
        setExpandedAccordions([]); // Collapse all accordions
    };

    return {
        testAddress,
        setTestAddress,
        testOrderLines,
        setTestOrderLines,
        testDataUpdated,
        setTestDataUpdated,
        hasTestedOnce,
        setHasTestedOnce,
        expandedAccordions,
        setExpandedAccordions,
        lastTestedAddress,
        lastTestedOrderLines,
        allTestDataPresent,
        handleAddressChange,
        handleOrderLinesChange,
        markTestRun,
    };
}
