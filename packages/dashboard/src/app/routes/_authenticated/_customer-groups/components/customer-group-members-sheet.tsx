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
import { PanelLeftOpen } from 'lucide-react';
import { CustomerGroupMembersTable } from './customer-group-members-table.js';

export interface CustomerGroupMembersSheetProps {
    customerGroupName: string;
    customerGroupId: string;
    children?: React.ReactNode;
}

export function CustomerGroupMembersSheet({
    customerGroupName,
    customerGroupId,
    children,
}: CustomerGroupMembersSheetProps) {
    return (
        <Sheet>
            <SheetTrigger render={<Button variant="outline" size="sm" className="flex items-center gap-2" />}>
                {children}
                <PanelLeftOpen className="w-4 h-4" />
            </SheetTrigger>
            <SheetContent className="min-w-[90vw] lg:min-w-[800px]">
                <SheetHeader>
                    <SheetTitle>
                        <Trans>Customer group members for {customerGroupName}</Trans>
                    </SheetTitle>
                    <SheetDescription>
                        <Trans>
                            These are the customers in the <strong>{customerGroupName}</strong> customer
                            group.
                        </Trans>
                    </SheetDescription>
                </SheetHeader>
                <div className="px-4">
                    <CustomerGroupMembersTable customerGroupId={customerGroupId} />
                </div>
            </SheetContent>
        </Sheet>
    );
}
