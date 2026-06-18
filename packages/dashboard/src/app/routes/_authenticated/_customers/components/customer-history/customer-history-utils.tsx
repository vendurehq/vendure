import { HistoryEntryItem } from '@/vdb/framework/extension-api/types/index.js';
import { Trans } from '@lingui/react/macro';
import { CheckIcon, Edit3, KeyIcon, Mail, MapPin, SquarePen, User, UserCheck, Users } from 'lucide-react';
import { CustomerHistoryCustomerDetail } from './customer-history-types.js';

export function customerHistoryUtils(customer: CustomerHistoryCustomerDetail) {
    const getTimelineIcon = (entry: HistoryEntryItem) => {
        switch (entry.type) {
            case 'CUSTOMER_REGISTERED':
                return <User className="h-4 w-4" />;
            case 'CUSTOMER_VERIFIED':
                return <UserCheck className="h-4 w-4" />;
            case 'CUSTOMER_NOTE':
                return <SquarePen className="h-4 w-4" />;
            case 'CUSTOMER_ADDED_TO_GROUP':
            case 'CUSTOMER_REMOVED_FROM_GROUP':
                return <Users className="h-4 w-4" />;
            case 'CUSTOMER_DETAIL_UPDATED':
                return <Edit3 className="h-4 w-4" />;
            case 'CUSTOMER_ADDRESS_CREATED':
            case 'CUSTOMER_ADDRESS_UPDATED':
            case 'CUSTOMER_ADDRESS_DELETED':
                return <MapPin className="h-4 w-4" />;
            case 'CUSTOMER_PASSWORD_UPDATED':
            case 'CUSTOMER_PASSWORD_RESET_REQUESTED':
            case 'CUSTOMER_PASSWORD_RESET_VERIFIED':
                return <KeyIcon className="h-4 w-4" />;
            case 'CUSTOMER_EMAIL_UPDATE_REQUESTED':
            case 'CUSTOMER_EMAIL_UPDATE_VERIFIED':
                return <Mail className="h-4 w-4" />;
            default:
                return <CheckIcon className="h-4 w-4" />;
        }
    };

    const getTitle = (entry: HistoryEntryItem) => {
        switch (entry.type) {
            case 'CUSTOMER_REGISTERED':
                return <Trans>Customer registered</Trans>;
            case 'CUSTOMER_VERIFIED':
                return <Trans>Customer verified</Trans>;
            case 'CUSTOMER_NOTE':
                return <Trans>Note added</Trans>;
            case 'CUSTOMER_DETAIL_UPDATED':
                return <Trans>Customer details updated</Trans>;
            case 'CUSTOMER_ADDED_TO_GROUP':
                return <Trans>Added to group</Trans>;
            case 'CUSTOMER_REMOVED_FROM_GROUP':
                return <Trans>Removed from group</Trans>;
            case 'CUSTOMER_ADDRESS_CREATED':
                return <Trans>Address created</Trans>;
            case 'CUSTOMER_ADDRESS_UPDATED':
                return <Trans>Address updated</Trans>;
            case 'CUSTOMER_ADDRESS_DELETED':
                return <Trans>Address deleted</Trans>;
            case 'CUSTOMER_PASSWORD_UPDATED':
                return <Trans>Password updated</Trans>;
            case 'CUSTOMER_PASSWORD_RESET_REQUESTED':
                return <Trans>Password reset requested</Trans>;
            case 'CUSTOMER_PASSWORD_RESET_VERIFIED':
                return <Trans>Password reset verified</Trans>;
            case 'CUSTOMER_EMAIL_UPDATE_REQUESTED':
                return <Trans>Email update requested</Trans>;
            case 'CUSTOMER_EMAIL_UPDATE_VERIFIED':
                return <Trans>Email update verified</Trans>;
            default:
                return <Trans>{entry.type.replace(/_/g, ' ').toLowerCase()}</Trans>;
        }
    };

    const getIconColor = (entry: HistoryEntryItem) => {
        // Check for success states
        if (
            entry.type === 'CUSTOMER_VERIFIED' ||
            entry.type === 'CUSTOMER_EMAIL_UPDATE_VERIFIED' ||
            entry.type === 'CUSTOMER_PASSWORD_RESET_VERIFIED'
        ) {
            return 'bg-success text-success-foreground';
        }

        // Check for destructive states
        if (entry.type === 'CUSTOMER_REMOVED_FROM_GROUP' || entry.type === 'CUSTOMER_ADDRESS_DELETED') {
            return 'bg-destructive text-destructive-foreground';
        }

        // Registration gets muted style
        if (entry.type === 'CUSTOMER_REGISTERED') {
            return 'bg-muted text-muted-foreground';
        }

        // All other entries use neutral colors
        return 'bg-muted text-muted-foreground';
    };

    const getActorName = (entry: HistoryEntryItem) => {
        if (entry.administrator) {
            return `${entry.administrator.firstName} ${entry.administrator.lastName}`;
        } else if (customer) {
            return `${customer.firstName} ${customer.lastName}`;
        }
        return '';
    };

    const isPrimaryEvent = (entry: HistoryEntryItem) => {
        switch (entry.type) {
            case 'CUSTOMER_REGISTERED':
            case 'CUSTOMER_VERIFIED':
            case 'CUSTOMER_NOTE':
            case 'CUSTOMER_EMAIL_UPDATE_VERIFIED':
            case 'CUSTOMER_PASSWORD_RESET_VERIFIED':
                return true;
            default:
                return false;
        }
    };

    return {
        getTimelineIcon,
        getTitle,
        getIconColor,
        getActorName,
        isPrimaryEvent,
    };
}
