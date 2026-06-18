import { Badge } from '@/vdb/components/ui/badge.js';
import { useChannel } from '@/vdb/hooks/use-channel.js';
import { Trans } from '@lingui/react/macro';
import { Check } from 'lucide-react';
import { MetadataBadges } from './metadata-badges.js';
import { PriceDisplay } from './price-display.js';
import { ShippingMethodTestResultWrapper } from './shipping-method-test-result-wrapper.js';

export interface ShippingMethodQuote {
    id: string;
    name: string;
    code: string;
    description: string;
    price: number;
    priceWithTax: number;
    metadata?: Record<string, any>;
}

interface ShippingEligibilityTestResultProps {
    testResult?: ShippingMethodQuote[];
    okToRun: boolean;
    testDataUpdated: boolean;
    hasTestedOnce: boolean;
    onRunTest: () => void;
    loading?: boolean;
}

export function TestShippingMethodsResult({
                                              testResult,
                                              okToRun,
                                              testDataUpdated,
                                              hasTestedOnce,
                                              onRunTest,
                                              loading = false,
                                          }: Readonly<ShippingEligibilityTestResultProps>) {
    const { activeChannel } = useChannel();
    const currencyCode = activeChannel?.defaultCurrencyCode ?? 'USD';
    const hasResults = testResult && testResult.length > 0;
    const showEmptyState = testResult?.length === 0 && !loading && !testDataUpdated;

    return (
        <ShippingMethodTestResultWrapper
            okToRun={okToRun}
            testDataUpdated={testDataUpdated}
            hasTestedOnce={hasTestedOnce}
            onRunTest={onRunTest}
            loading={loading}
            showEmptyState={showEmptyState}
            emptyState={
                <div className="text-center py-8">
                    <p className="text-muted-foreground">
                        <Trans>No eligible shipping methods found for this order.</Trans>
                    </p>
                </div>
            }
            loadingLabel={<Trans>Testing shipping methods...</Trans>}
        >
            {hasResults && (
                <div className="space-y-3">
                    <div className="flex items-center gap-2 mb-4">
                        <span className="text-sm font-medium">
                            <Trans>
                                Found {testResult.length} eligible shipping method
                                {testResult.length !== 1 ? 's' : ''}
                            </Trans>
                        </span>
                    </div>
                    {testResult.map(method => (
                        <div
                            key={method.id}
                            className="flex items-center text-sm justify-between p-3 rounded-lg bg-muted/50"
                        >
                            <div className="flex-1">
                                <div className="flex gap-1">
                                    <Check className="h-5 w-5 text-success" />
                                    <div className="">{method.name}</div>
                                </div>
                                <Badge variant="secondary">{method.code}</Badge>
                                {method.description && (
                                    <div className="text-sm text-muted-foreground mt-1">
                                        {method.description}
                                    </div>
                                )}
                                <MetadataBadges metadata={method.metadata} />
                            </div>
                            <PriceDisplay
                                price={method.price}
                                priceWithTax={method.priceWithTax}
                                currencyCode={currencyCode}
                            />
                        </div>
                    ))}
                </div>
            )}
        </ShippingMethodTestResultWrapper>
    );
}
