import { StatusBadge } from '@/vdb/components/ui/status-badge.js';
import { defineStateEntries } from '@/vdb/components/ui/status-badge.js';
import { Trans } from '@lingui/react/macro';
import { BadgeCheck, BadgeX } from 'lucide-react';

export type CustomerStatus = 'guest' | 'registered' | 'verified';

export interface CustomerStatusBadgeProps {
    user?: { verified: boolean } | null;
}

// Customer account status. `verified` is a healthy terminal state (success);
// `registered` is a noteworthy fact — an account exists but is not yet verified
// (info); `guest` has no account (neutral).
const customerStatusDictionary = defineStateEntries<CustomerStatus>({
    verified: { tone: 'success', defaultLabel: 'Verified' },
    registered: { tone: 'info', defaultLabel: 'Registered' },
    guest: { tone: 'neutral', defaultLabel: 'Unverified' },
});

export function CustomerStatusBadge({ user }: Readonly<CustomerStatusBadgeProps>) {
    const status: CustomerStatus = user ? (user.verified ? 'verified' : 'registered') : 'guest';
    // The icon goes in `icon`, not in the children: the chip sizes and spaces its own icon.
    return (
        <StatusBadge
            tone={customerStatusDictionary.toneFor(status)}
            icon={status === 'guest' ? <BadgeX /> : <BadgeCheck />}
        >
            {status === 'verified' ? (
                <Trans>Verified</Trans>
            ) : status === 'registered' ? (
                <Trans>Registered</Trans>
            ) : (
                <Trans>Unverified</Trans>
            )}
        </StatusBadge>
    );
}
