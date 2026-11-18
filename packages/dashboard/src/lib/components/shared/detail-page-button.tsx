import { DataTableContext } from '@/vdb/components/data-table/data-table-context.js';
import { Link } from '@tanstack/react-router';
import { DataTableRowLink } from '@vendure-io/ui/components/molecules/data-table/data-table';
import { ChevronRight } from 'lucide-react';
import { useContext } from 'react';
import { Button } from '../ui/button.js';

/**
 * @description
 * DetailPageButton is a reusable navigation component designed to provide consistent UX
 * across list views when linking to detail pages.
 *
 * In a data table row it is the row link: a click on any point of the row opens the detail
 * page, and a chevron shows at the end of the row while it is hovered or holds keyboard focus.
 * Buttons, links, menus and copy chips in the row keep their own click. The label is the
 * accessible name of the row. Outside a data table it renders as a ghost button with a chevron.
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
    const inDataTable = useContext(DataTableContext) !== undefined;
    if (!id && !href) {
        return <span className={className}>{label}</span>;
    }
    if (inDataTable) {
        if (disabled) {
            return <span className={className}>{label}</span>;
        }
        return (
            <DataTableRowLink
                render={<Link to={href ?? `./${id}`} search={search ?? {}} preload={false} />}
                className={className}
            >
                {label}
            </DataTableRowLink>
        );
    }
    return (
        <Button
            render={<Link to={href ?? `./${id}`} search={search ?? {}} preload={false} />}
            variant="ghost"
            disabled={disabled}
            className={className}
        >
            {label}
            {!disabled && <ChevronRight className="h-3 w-3 text-muted-foreground" />}
        </Button>
    );
}
