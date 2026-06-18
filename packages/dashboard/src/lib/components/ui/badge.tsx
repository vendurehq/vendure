import * as React from 'react';

import { cn } from '@/vdb/lib/utils.js';

import {
    Badge as BaseBadge,
} from '@vendure-io/ui/components/ui/badge';

type BaseBadgeProps = React.ComponentProps<typeof BaseBadge>;

export type BadgeProps = Omit<BaseBadgeProps, 'variant'> & {
    variant?: BaseBadgeProps['variant'] | 'success' | 'warning';
};

const customVariantStyles: Record<string, string> = {
    success: 'bg-success/10 text-success dark:bg-success/20 [a]:hover:bg-success/20',
    warning: 'bg-warning/10 text-warning dark:bg-warning/20 [a]:hover:bg-warning/20',
};

/**
 * Wrapper around @vendure-io/ui Badge that adds the "success" and "warning"
 * variants which are used in the dashboard but not available in the base library.
 */
function Badge({ className, variant, ...props }: BadgeProps) {
    const custom = variant && customVariantStyles[variant];
    if (custom) {
        return <BaseBadge className={cn(custom, className)} {...props} />;
    }
    return <BaseBadge className={className} variant={variant as BaseBadgeProps['variant']} {...props} />;
}

export { Badge };
export { badgeVariants } from '@vendure-io/ui/components/ui/badge';
