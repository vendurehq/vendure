import { cn } from '@/vdb/lib/utils.js';
import {
    Sheet,
    SheetClose,
    SheetContent as OriginalSheetContent,
    SheetDescription,
    SheetFooter,
    SheetHeader,
    SheetTitle,
    SheetTrigger,
} from '@vendure-io/ui/components/ui/sheet';

/**
 * Wrapper around the upstream SheetContent that overrides the max-width
 * from `sm:max-w-sm` (384px) to `sm:max-w-lg` (512px) so that panels
 * have enough room for tables, badges, and other content.
 */
function SheetContent({
    className,
    ...props
}: React.ComponentProps<typeof OriginalSheetContent>) {
    return (
        <OriginalSheetContent
            className={cn('data-[side=left]:sm:max-w-lg data-[side=right]:sm:max-w-lg', className)}
            {...props}
        />
    );
}

export {
    Sheet,
    SheetClose,
    SheetContent,
    SheetDescription,
    SheetFooter,
    SheetHeader,
    SheetTitle,
    SheetTrigger,
};
