import { defineStateEntries, type Tone } from '@/vdb/components/ui/status-badge.js';
import { HistoryEntryItem } from '@/vdb/framework/extension-api/types/index.js';
import { Trans } from '@lingui/react/macro';
import { CheckIcon, Edit3, KeyIcon, Mail, MapPin, SquarePen, User, UserCheck, Users } from 'lucide-react';
import { CustomerHistoryCustomerDetail } from './customer-history-types.js';

/**
 * The marker tone of each customer history entry type. A verification the
 * customer completed is `success`; every other entry is routine and stays
 * `neutral`, so the verified steps stand out.
 */
const customerHistoryDictionary = defineStateEntries({
    CUSTOMER_REGISTERED: { tone: 'neutral', defaultLabel: 'Registered' },
    CUSTOMER_VERIFIED: { tone: 'success', defaultLabel: 'Verified' },
    CUSTOMER_NOTE: { tone: 'neutral', defaultLabel: 'Note added' },
    CUSTOMER_DETAIL_UPDATED: { tone: 'neutral', defaultLabel: 'Details updated' },
    CUSTOMER_ADDED_TO_GROUP: { tone: 'neutral', defaultLabel: 'Added to group' },
    CUSTOMER_REMOVED_FROM_GROUP: { tone: 'neutral', defaultLabel: 'Removed from group' },
    CUSTOMER_ADDRESS_CREATED: { tone: 'neutral', defaultLabel: 'Address created' },
    CUSTOMER_ADDRESS_UPDATED: { tone: 'neutral', defaultLabel: 'Address updated' },
    CUSTOMER_ADDRESS_DELETED: { tone: 'neutral', defaultLabel: 'Address deleted' },
    CUSTOMER_PASSWORD_UPDATED: { tone: 'neutral', defaultLabel: 'Password updated' },
    CUSTOMER_PASSWORD_RESET_REQUESTED: { tone: 'neutral', defaultLabel: 'Password reset requested' },
    CUSTOMER_PASSWORD_RESET_VERIFIED: { tone: 'success', defaultLabel: 'Password reset verified' },
    CUSTOMER_EMAIL_UPDATE_REQUESTED: { tone: 'neutral', defaultLabel: 'Email update requested' },
    CUSTOMER_EMAIL_UPDATE_VERIFIED: { tone: 'success', defaultLabel: 'Email update verified' },
});

export function customerHistoryUtils(customer: CustomerHistoryCustomerDetail) {
    const getTimelineIcon = (entry: HistoryEntryItem) => {
        switch (entry.type) {
            case 'CUSTOMER_REGISTERED':
                return <User />;
            case 'CUSTOMER_VERIFIED':
                return <UserCheck />;
            case 'CUSTOMER_NOTE':
                return <SquarePen />;
            case 'CUSTOMER_ADDED_TO_GROUP':
            case 'CUSTOMER_REMOVED_FROM_GROUP':
                return <Users />;
            case 'CUSTOMER_DETAIL_UPDATED':
                return <Edit3 />;
            case 'CUSTOMER_ADDRESS_CREATED':
            case 'CUSTOMER_ADDRESS_UPDATED':
            case 'CUSTOMER_ADDRESS_DELETED':
                return <MapPin />;
            case 'CUSTOMER_PASSWORD_UPDATED':
            case 'CUSTOMER_PASSWORD_RESET_REQUESTED':
            case 'CUSTOMER_PASSWORD_RESET_VERIFIED':
                return <KeyIcon />;
            case 'CUSTOMER_EMAIL_UPDATE_REQUESTED':
            case 'CUSTOMER_EMAIL_UPDATE_VERIFIED':
                return <Mail />;
            default:
                return <CheckIcon />;
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

    const getTone = (entry: HistoryEntryItem): Tone => customerHistoryDictionary.toneFor(entry.type);

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
        getTone,
        getActorName,
        isPrimaryEvent,
    };
}
