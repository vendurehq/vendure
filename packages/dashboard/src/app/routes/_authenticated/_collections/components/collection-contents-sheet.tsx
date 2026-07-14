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
import { CollectionContentsTable } from './collection-contents-table.js';

export interface CollectionContentsSheetProps {
    collectionId: string;
    collectionName: string;
    children?: React.ReactNode;
}

export function CollectionContentsSheet({
    collectionId,
    collectionName,
    children,
}: CollectionContentsSheetProps) {
    return (
        <Sheet>
            <SheetTrigger render={<Button variant="outline" size="sm" className="flex items-center gap-2" />}>
                {children}
                <PanelLeftOpen className="w-4 h-4" />
            </SheetTrigger>
            <SheetContent className="min-w-[90vw] lg:min-w-[800px]">
                <SheetHeader>
                    <SheetTitle>
                        <Trans>Collection contents for {collectionName}</Trans>
                    </SheetTitle>
                    <SheetDescription>
                        <Trans>
                            This is the contents of the <strong>{collectionName}</strong> collection.
                        </Trans>
                    </SheetDescription>
                </SheetHeader>
                <div className="px-4">
                    <CollectionContentsTable collectionId={collectionId} />
                </div>
            </SheetContent>
        </Sheet>
    );
}
