import * as React from 'react';

import { cn } from '@/vdb/lib/utils.js';

/**
 * Plain `<input>` instead of @vendure-io/ui's Input, which wraps Base UI's
 * Field.Control and conflicts with react-hook-form's isDirty detection.
 * Classes synced from @vendure-io/ui v1.0.5.
 */
function Input({ className, type, value, ...props }: React.ComponentProps<'input'>) {
    return (
        <input
            type={type}
            data-slot="input"
            value={value === null ? '' : value}
            className={cn(
                'dark:bg-input/30 border-input focus-visible:border-ring focus-visible:ring-ring/50 aria-invalid:ring-destructive/20 dark:aria-invalid:ring-destructive/40 aria-invalid:border-destructive dark:aria-invalid:border-destructive/50 file:text-foreground placeholder:text-muted-foreground h-9 w-full min-w-0 rounded-md border bg-transparent px-2.5 py-1 text-base transition-[color,box-shadow] outline-none file:inline-flex file:h-7 file:border-0 file:bg-transparent file:text-sm file:font-medium focus-visible:ring-3 disabled:pointer-events-none disabled:cursor-not-allowed disabled:opacity-50 aria-invalid:ring-3 md:text-sm',
                className,
            )}
            {...props}
        />
    );
}

export { Input };
