import { Alert, AlertDescription } from '@/vdb/components/ui/alert.js';
import { Button } from '@/vdb/components/ui/button.js';
import { Card, CardContent, CardHeader, CardTitle } from '@/vdb/components/ui/card.js';
import { Trans } from '@lingui/react/macro';
import { PlayIcon } from 'lucide-react';
import React from 'react';

interface ShippingMethodTestResultWrapperProps {
    okToRun: boolean;
    testDataUpdated: boolean;
    hasTestedOnce: boolean;
    onRunTest: () => void;
    loading?: boolean;
    children: React.ReactNode;
    emptyState?: React.ReactNode;
    showEmptyState?: boolean;
    runTestLabel?: React.ReactNode;
    loadingLabel?: React.ReactNode;
}

export function ShippingMethodTestResultWrapper({
    okToRun,
    testDataUpdated,
    hasTestedOnce,
    onRunTest,
    loading = false,
    children,
    emptyState,
    showEmptyState = false,
    runTestLabel = <Trans>Run Test</Trans>,
    loadingLabel = <Trans>Testing shipping method...</Trans>,
}: Readonly<ShippingMethodTestResultWrapperProps>) {
    const canRunTest = okToRun && testDataUpdated;
    return (
        <Card>
            <CardHeader>
                <CardTitle className="flex items-center justify-between">
                    <span>
                        <Trans>Test Results</Trans>
                    </span>
                    {okToRun && (
                        <Button
                            onClick={onRunTest}
                            disabled={!canRunTest || loading}
                            size="sm"
                            className="ml-auto"
                        >
                            <PlayIcon className="mr-1 h-4 w-4" />
                            {runTestLabel}
                        </Button>
                    )}
                </CardTitle>
            </CardHeader>
            <CardContent>
                {!okToRun && (
                    <Alert>
                        <AlertDescription>
                            <Trans>
                                Please add products and complete the shipping address to run the test.
                            </Trans>
                        </AlertDescription>
                    </Alert>
                )}

                {okToRun && testDataUpdated && hasTestedOnce && (
                    <Alert variant="destructive">
                        <AlertDescription>
                            <Trans>
                                Test data has been updated. Click "Run Test" to see updated results.
                            </Trans>
                        </AlertDescription>
                    </Alert>
                )}

                {loading && (
                    <div className="text-center py-8">
                        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary mx-auto"></div>
                        <p className="mt-2 text-sm text-muted-foreground">{loadingLabel}</p>
                    </div>
                )}

                {!loading && showEmptyState && emptyState}
                {!loading && !showEmptyState && children}
            </CardContent>
        </Card>
    );
}
