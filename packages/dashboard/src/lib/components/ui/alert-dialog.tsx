import { cn } from '@/vdb/lib/utils.js';
import { AlertDialogTitle as AlertDialogTitleBase } from '@vendure-io/ui/components/ui/alert-dialog';

export {
    AlertDialog,
    AlertDialogAction,
    AlertDialogCancel,
    AlertDialogContent,
    AlertDialogDescription,
    AlertDialogFooter,
    AlertDialogHeader,
    AlertDialogMedia,
    AlertDialogOverlay,
    AlertDialogPortal,
    AlertDialogTrigger,
} from '@vendure-io/ui/components/ui/alert-dialog';

// Override AlertDialogTitle to use the heading font (Public Sans). Wrap the
// base wrapper rather than the primitive — see dialog.tsx for the rationale.
export function AlertDialogTitle({
    className,
    ...props
}: React.ComponentProps<typeof AlertDialogTitleBase>) {
    return <AlertDialogTitleBase className={cn('font-heading', className)} {...props} />;
}
