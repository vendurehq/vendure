import { useChannel } from '@/vdb/hooks/use-channel.js';
import { Trans } from '@lingui/react/macro';
import { ResultOf } from 'gql.tada';
import { Check } from 'lucide-react';
import { testShippingMethodDocument } from '../shipping-methods.graphql.js';
import { MetadataBadges } from './metadata-badges.js';
import { PriceDisplay } from './price-display.js';
import { ShippingMethodTestResultWrapper } from './shipping-method-test-result-wrapper.js';

export type TestShippingMethodResult = ResultOf<typeof testShippingMethodDocument>['testShippingMethod'];

interface TestSingleMethodResultProps {
    testResult?: TestShippingMethodResult;
    okToRun: boolean;
    testDataUpdated: boolean;
    hasTestedOnce: boolean;
    onRunTest: () => void;
    loading?: boolean;
}

export function TestSingleMethodResult({
                                           testResult,
                                           okToRun,
                                           testDataUpdated,
                                           hasTestedOnce,
                                           onRunTest,
                                           loading = false,
                                       }: Readonly<TestSingleMethodResultProps>) {
    const { activeChannel } = useChannel();
    const currencyCode = activeChannel?.defaultCurrencyCode ?? 'USD';
    const showEmptyState = testResult === undefined && hasTestedOnce && !testDataUpdated && !loading;

    return (
        <ShippingMethodTestResultWrapper
            okToRun={okToRun}
            testDataUpdated={testDataUpdated}
            hasTestedOnce={hasTestedOnce}
            onRunTest={onRunTest}
            loading={loading}
            showEmptyState={showEmptyState}
            emptyState={
                <div className="text-center py-8 text-muted-foreground">
                    <Trans>Click "Run Test" to test this shipping method.</Trans>
                </div>
            }
            loadingLabel={<Trans>Testing shipping method...</Trans>}
        >
            {testResult && (
                <div className="space-y-4">
                    {testResult.eligible ? (
                        <div className="space-y-3">
                            {testResult.quote && (
                                <div className="p-3 border rounded-lg bg-muted/50">
                                    <div className="flex justify-between items-center">
                                        <div className="flex items-center gap-2">
                                            <Check className="h-5 w-5 text-success" />
                                            <span className="text-sm">
                                                <Trans>Shipping method is eligible for this order</Trans>
                                            </span>
                                        </div>
                                        <PriceDisplay
                                            price={testResult.quote.price}
                                            priceWithTax={testResult.quote.priceWithTax}
                                            currencyCode={currencyCode}
                                        />
                                    </div>
                                    <div className="flex-1">
                                        <MetadataBadges metadata={testResult.quote.metadata} />
                                    </div>
                                </div>
                            )}
                        </div>
                    ) : (
                        <div className="text-center py-8">
                            <p className="text-destructive">
                                <Trans>Shipping method is not eligible for this order</Trans>
                            </p>
                            <p className="text-sm text-muted-foreground mt-2">
                                <Trans>
                                    This shipping method's eligibility checker conditions are not met for the
                                    current order and shipping address.
                                </Trans>
                            </p>
                        </div>
                    )}
                </div>
            )}
        </ShippingMethodTestResultWrapper>
    );
}
