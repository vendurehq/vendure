import { Button } from '@/vdb/components/ui/button.js';
import { ScrollArea } from '@/vdb/components/ui/scroll-area.js';
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle, SheetTrigger } from '@/vdb/components/ui/sheet.js';
import { FullWidthPageBlock } from '@/vdb/framework/layout-engine/page-layout.js';
import { ZoneCountriesTable } from './zone-countries-table.js';

interface ZoneCountriesSheetProps {
    zoneId: string;
    zoneName: string;
    children?: React.ReactNode;
}

export function ZoneCountriesSheet({ zoneId, zoneName, children }: Readonly<ZoneCountriesSheetProps>) {
    return (
        <Sheet>
            <SheetTrigger render={<Button variant="outline" size="sm" className="flex items-center gap-2" />}>
                {children}
            </SheetTrigger>
            <SheetContent className="min-w-[800px]">
                <SheetHeader>
                    <SheetTitle>{zoneName}</SheetTitle>
                    <SheetDescription className="sr-only">
                        View and manage countries assigned to the {zoneName} zone
                    </SheetDescription>
                </SheetHeader>
                <div className="flex items-center gap-2"></div>
                <ScrollArea className="px-6 max-h-[600px]">
                    <FullWidthPageBlock blockId="zone-countries">
                        <ZoneCountriesTable zoneId={zoneId} />
                    </FullWidthPageBlock>
                </ScrollArea>
            </SheetContent>
        </Sheet>
    );
}
