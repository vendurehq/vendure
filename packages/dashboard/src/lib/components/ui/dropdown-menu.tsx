import { cn } from '@/vdb/lib/utils.js';
import {
    DropdownMenu,
    DropdownMenuCheckboxItem,
    DropdownMenuContent as OriginalDropdownMenuContent,
    DropdownMenuGroup,
    DropdownMenuItem,
    DropdownMenuLabel,
    DropdownMenuPortal,
    DropdownMenuRadioGroup,
    DropdownMenuRadioItem,
    DropdownMenuSeparator,
    DropdownMenuShortcut,
    DropdownMenuSub,
    DropdownMenuSubContent,
    DropdownMenuSubTrigger,
    DropdownMenuTrigger,
} from '@vendure-io/ui/components/ui/dropdown-menu';

/**
 * Wrapper around the upstream DropdownMenuContent that removes the
 * `w-(--anchor-width)` constraint. Dropdown menus should auto-size
 * to their content, not be constrained to the trigger button's width.
 */
function DropdownMenuContent({
    className,
    ...props
}: React.ComponentProps<typeof OriginalDropdownMenuContent>) {
    return <OriginalDropdownMenuContent className={cn('w-auto', className)} {...props} />;
}

export {
    DropdownMenu,
    DropdownMenuCheckboxItem,
    DropdownMenuContent,
    DropdownMenuGroup,
    DropdownMenuItem,
    DropdownMenuLabel,
    DropdownMenuPortal,
    DropdownMenuRadioGroup,
    DropdownMenuRadioItem,
    DropdownMenuSeparator,
    DropdownMenuShortcut,
    DropdownMenuSub,
    DropdownMenuSubContent,
    DropdownMenuSubTrigger,
    DropdownMenuTrigger,
};
