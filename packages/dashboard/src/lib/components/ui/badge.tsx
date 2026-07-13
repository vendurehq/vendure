import * as React from 'react';

import { cn } from '@/vdb/lib/utils.js';

import {
    Badge as BaseBadge,
} from '@vendure-io/ui/components/atoms/badge';

type BaseBadgeProps = React.ComponentProps<typeof BaseBadge>;

export type BadgeProps = Omit<BaseBadgeProps, 'variant'> & {
    /**
     * In addition to the base variants, "success" and "warning" are dashboard extensions.
     * "secondary" was removed in @vendure-io/ui v2 and is kept only as a deprecated
     * alias of the neutral "default" variant for extension compatibility.
     */
    variant?: BaseBadgeProps['variant'] | 'success' | 'warning' | 'secondary';
};

const customVariantStyles: Record<string, string> = {
    success: 'bg-success/10 text-success dark:bg-success/20 [a]:hover:bg-success/20',
    warning: 'bg-warning/10 text-warning dark:bg-warning/20 [a]:hover:bg-warning/20',
};

/**
 * Wrapper around @vendure-io/ui Badge that adds the "success" and "warning"
 * variants which are used in the dashboard but not available in the base library,
 * and preserves the removed "secondary" variant as an alias of "default".
 */
function Badge({ className, variant, ...props }: BadgeProps) {
    const custom = variant && customVariantStyles[variant];
    if (custom) {
        return <BaseBadge className={cn(custom, className)} {...props} />;
    }
    const baseVariant = variant === 'secondary' ? 'default' : variant;
    return (
        <BaseBadge className={className} variant={baseVariant as BaseBadgeProps['variant']} {...props} />
    );
}

export { Badge };
export { badgeVariants } from '@vendure-io/ui/components/atoms/badge';
