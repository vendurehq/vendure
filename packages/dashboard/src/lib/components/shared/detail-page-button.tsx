import { Link } from '@tanstack/react-router';
import { ChevronRight } from 'lucide-react';
import { Button } from '../ui/button.js';

/**
 * @description
 * DetailPageButton is a reusable navigation component designed to provide consistent UX
 * across list views when linking to detail pages. It renders as a ghost button with
 * a chevron indicator, making it easy for users to identify clickable links that
 * navigate to detail views.
 *
 * @example
 * ```tsx
 * // Basic usage with ID (relative navigation)
 * <DetailPageButton id="123" label="Product Name" />
 *
 *
 * @example
 * ```tsx
 * // Custom href with search params
 * <DetailPageButton
 *   href="/products/detail/456"
 *   label="Custom Product"
 *   search={{ tab: 'variants' }}
 * />
 * ```
 *
 *
 * @docsCategory components
 * @docsPage DetailPageButton
 * @since 3.4.0
 */
export function DetailPageButton({
    id,
    href,
    label,
    disabled,
    search,
    className,
}: Readonly<{
    label: string | React.ReactNode;
    id?: string;
    href?: string;
    disabled?: boolean;
    search?: Record<string, string>;
    className?: string;
}>) {
    if (!id && !href) {
        return <span>{label}</span>;
    }
    return (
        <Button render={<Link to={href ?? `./${id}`} search={search ?? {}} preload={false} />} variant="ghost" disabled={disabled} className={className}>
                {label}
                {!disabled && <ChevronRight className="h-3 w-3 text-muted-foreground" />}
        </Button>
    );
}
