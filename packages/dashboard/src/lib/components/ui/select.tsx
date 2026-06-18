import * as React from 'react';
import {
    Select,
    SelectContent as OriginalSelectContent,
    SelectGroup,
    SelectItem,
    SelectLabel,
    SelectScrollDownButton,
    SelectScrollUpButton,
    SelectSeparator,
    SelectTrigger,
    SelectValue,
} from '@vendure-io/ui/components/ui/select';

/**
 * Wrapper around the upstream SelectContent that forces a remount when
 * children change. This works around a Base UI Select issue where the
 * internal item registry doesn't update when items change dynamically
 * while the controlled value stays the same (e.g., value="" fire-and-forget
 * pattern used for state transitions).
 *
 * Deriving a key from children values causes unmount/remount of the popup,
 * which forces items to re-register in Base UI's collection.
 *
 * NOTE: Only inspects top-level children. If SelectItems are nested
 * inside SelectGroup or fragments, the key may not update correctly.
 */
function SelectContent({
    children,
    ...props
}: React.ComponentProps<typeof OriginalSelectContent>) {
    const childrenKey = React.useMemo(
        () =>
            React.Children.toArray(children)
                .map(c => (React.isValidElement(c) ? (c.props as any)?.value ?? c.key : ''))
                .join('|'),
        [children],
    );

    return (
        <OriginalSelectContent key={childrenKey} {...props}>
            {children}
        </OriginalSelectContent>
    );
}

export {
    Select,
    SelectContent,
    SelectGroup,
    SelectItem,
    SelectLabel,
    SelectScrollDownButton,
    SelectScrollUpButton,
    SelectSeparator,
    SelectTrigger,
    SelectValue,
};
