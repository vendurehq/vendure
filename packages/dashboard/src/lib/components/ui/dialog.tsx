import { cn } from '@/vdb/lib/utils.js';
import { DialogTitle as DialogTitleBase } from '@vendure-io/ui/components/ui/dialog';

export {
    Dialog,
    DialogClose,
    DialogContent,
    DialogDescription,
    DialogFooter,
    DialogHeader,
    DialogOverlay,
    DialogPortal,
    DialogTrigger,
} from '@vendure-io/ui/components/ui/dialog';

// Override DialogTitle to use the heading font (Public Sans). Wrap the base
// wrapper rather than the primitive — going through the primitive directly
// can resolve to a different module instance, leaving the title outside the
// Dialog root context ("Cannot destructure property 'store' of
// useDialogRootContext(...)").
export function DialogTitle({
    className,
    ...props
}: React.ComponentProps<typeof DialogTitleBase>) {
    return <DialogTitleBase className={cn('font-heading', className)} {...props} />;
}
