import { IdentifierDisplay } from '@/vdb/components/data-display/identifier.js';
import { Money } from '@/vdb/components/data-display/money.js';
import { DetailPageButton } from '@/vdb/components/shared/detail-page-button.js';
import { DataTableCellComponent } from '@/vdb/components/data-table/types.js';
import { Button } from '@/vdb/components/ui/button.js';
import { StatusBadge } from '@/vdb/components/ui/status-badge.js';
import { useDynamicTranslations } from '@/vdb/hooks/use-dynamic-translations.js';
import { orderStateDictionary } from '@/vdb/utils/state-type.js';
import { useLingui } from '@lingui/react/macro';
import { Link } from '@tanstack/react-router';
import { ChevronDown, ChevronUp, CircleSlashIcon, TruckIcon } from 'lucide-react';
import React, { useMemo, useState } from 'react';

type CustomerCellData = {
    customer: {
        id: string;
        firstName: string;
        lastName: string;
    } | null;
};

export const CustomerCell: DataTableCellComponent<CustomerCellData> = ({ row }) => {
    const value = row.original.customer;
    if (!value) {
        return null;
    }
    // A plain link: in a list row it sits above the row link, so it opens the customer.
    return (
        <Link to={`/customers/${value.id}`} className="underline-offset-4 hover:underline">
            {value.firstName} {value.lastName}
        </Link>
    );
};

// States whose shape says more than the tone icon. Every other state takes the icon of its tone.
const orderStateIcons: Record<string, React.ReactNode> = {
    PartiallyShipped: <TruckIcon />,
    Shipped: <TruckIcon />,
    PartiallyDelivered: <TruckIcon />,
    Cancelled: <CircleSlashIcon />,
};

/**
 * The order code is the name of an order row and the value a user copies. The row link carries
 * the name for screen readers; the visible code is a copy chip on row hover.
 */
export const OrderCodeCell: DataTableCellComponent<{ id: string; code: string }> = ({ row }) => {
    const { t } = useLingui();
    const { id, code } = row.original;
    return (
        <>
            <DetailPageButton href={`/orders/${id}`} label={<span className="sr-only">{t`Order ${code}`}</span>} />
            <IdentifierDisplay value={code} />
        </>
    );
};

/**
 * An order state as an icon and a label, the form a state takes in a list. A state the
 * dictionary does not know shows in sentence case with a neutral icon.
 */
export function OrderStateLabel({ state }: Readonly<{ state: string }>) {
    const { getTranslatedOrderState } = useDynamicTranslations();
    return (
        <StatusBadge appearance="icon" tone={orderStateDictionary.toneFor(state)} icon={orderStateIcons[state]}>
            {getTranslatedOrderState(state)}
        </StatusBadge>
    );
}

export const OrderStateCell: DataTableCellComponent<{ state: string }> = ({ row }) => {
    const value = row.original.state;
    if (!value) {
        return null;
    }
    return <OrderStateLabel state={value} />;
};

export const OrderMoneyCell: DataTableCellComponent<{ currencyCode: string }> = ({ cell, row }) => {
    const value = cell.getValue();
    const currencyCode = row.original.currencyCode;
    return <Money value={value} currency={currencyCode} />;
};

export const RichTextDescriptionCell: DataTableCellComponent<{ description: string }> = ({ cell }) => {
    const [isExpanded, setIsExpanded] = useState(false);
    const value = cell.getValue();

    // Strip HTML tags and decode HTML entities
    const textContent = useMemo(() => {
        if (!value) return '';
        // Use an inert DOMParser document, which (unlike assigning to a live
        // element's innerHTML) does not execute scripts or load resources such as
        // <img src=x onerror=...>, so stripping HTML cannot trigger stored XSS.
        return new DOMParser().parseFromString(value, 'text/html').body.textContent ?? '';
    }, [value]);

    const shortLength = 100;
    const maxLength = 500;
    const isTooLong = textContent.length > shortLength;

    const displayText = isExpanded ? textContent.slice(0, maxLength) : textContent.slice(0, shortLength);

    return (
        <div>
            <div>
                {displayText}
                {!isExpanded && isTooLong && '...'}
            </div>
            {!isExpanded && isTooLong && (
                <Button onClick={() => setIsExpanded(true)} variant="ghost" size="xs">
                    <ChevronDown />
                </Button>
            )}
            {isExpanded && (
                <Button onClick={() => setIsExpanded(false)} variant="ghost" size="xs">
                    <ChevronUp />
                </Button>
            )}
        </div>
    );
};
