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
import { FlaskConical } from 'lucide-react';
import { useState } from 'react';
import { TestShippingMethods } from './test-shipping-methods.js';

export function TestShippingMethodsSheet() {
    const [open, setOpen] = useState(false);

    return (
        <Sheet open={open} onOpenChange={setOpen}>
            <SheetTrigger render={<Button variant="secondary" />}>
                <FlaskConical />
                <Trans>Test</Trans>
            </SheetTrigger>
            <SheetContent size="xl">
                <SheetHeader>
                    <SheetTitle>
                        <Trans>Test shipping methods</Trans>
                    </SheetTitle>
                    <SheetDescription>
                        <Trans>Test your shipping methods by simulating a new order.</Trans>
                    </SheetDescription>
                </SheetHeader>
                <div className="mt-6">
                    <TestShippingMethods />
                </div>
            </SheetContent>
        </Sheet>
    );
}
