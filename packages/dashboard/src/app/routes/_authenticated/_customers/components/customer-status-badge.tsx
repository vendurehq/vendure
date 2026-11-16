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
    return (
        <StatusBadge tone={customerStatusDictionary.toneFor(status)}>
            {status === 'verified' ? (
                <>
                    <BadgeCheck className="size-3.5" />
                    <Trans>Verified</Trans>
                </>
            ) : status === 'registered' ? (
                <>
                    <BadgeCheck className="size-3.5" />
                    <Trans>Registered</Trans>
                </>
            ) : (
                <>
                    <BadgeX className="size-3.5" />
                    <Trans>Unverified</Trans>
                </>
            )}
        </StatusBadge>
    );
}
