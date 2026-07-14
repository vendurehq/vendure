import { Button } from '@/vdb/components/ui/button.js';
import {
    Sheet,
    SheetContent,
    SheetDescription,
    SheetHeader,
    SheetTitle,
    SheetTrigger,
} from '@/vdb/components/ui/sheet.js';
import { Trans } from '@lingui/react/macro';
import { VariablesOf } from 'gql.tada';
import { FlaskConical } from 'lucide-react';
import { useState } from 'react';
import { testShippingMethodDocument } from '../shipping-methods.graphql.js';
import { TestSingleShippingMethod } from './test-single-shipping-method.js';

interface TestSingleShippingMethodDialogProps {
    checker?: VariablesOf<typeof testShippingMethodDocument>['input']['checker'];
    calculator?: VariablesOf<typeof testShippingMethodDocument>['input']['calculator'];
}

export function TestSingleShippingMethodSheet({
                                                  checker,
                                                  calculator,
                                              }: Readonly<TestSingleShippingMethodDialogProps>) {
    const [open, setOpen] = useState(false);

    return (
        <Sheet open={open} onOpenChange={setOpen}>
            <SheetTrigger render={<Button variant="secondary" />}>
                <FlaskConical />
                <Trans>Test</Trans>
            </SheetTrigger>
            <SheetContent className="w-[800px] sm:max-w-[800px]">
                <SheetHeader>
                    <SheetTitle>
                        <Trans>Test Shipping Method</Trans>
                    </SheetTitle>
                    <SheetDescription>
                        <Trans>
                            Test this shipping method by simulating an order to see if it's eligible and what
                            the shipping cost would be.
                        </Trans>
                    </SheetDescription>
                </SheetHeader>
                <div className="mt-6">
                    {checker && calculator ? (
                        <TestSingleShippingMethod checker={checker} calculator={calculator} />
                    ) : null}
                </div>
            </SheetContent>
        </Sheet>
    );
}
