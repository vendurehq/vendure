import { Badge } from '@/vdb/components/ui/badge.js';
import { Trans } from '@lingui/react/macro';
import { BadgeCheck, BadgeX } from 'lucide-react';

export type CustomerStatus = 'guest' | 'registered' | 'verified';

export interface CustomerStatusBadgeProps {
    user?: { verified: boolean } | null;
}

export function CustomerStatusBadge({ user }: Readonly<CustomerStatusBadgeProps>) {
    const status = user ? (user.verified ? 'verified' : 'registered') : 'guest';
    return (
        <Badge variant="outline">
            {status === 'verified' ? (
                <div className="flex items-center gap-2">
                    <BadgeCheck className="w-4 h-4 text-success" />
                    <Trans>Verified</Trans>
                </div>
            ) : status === 'registered' ? (
                <div className="flex items-center gap-2">
                    <BadgeCheck className="w-4 h-4" />
                    <Trans>Registered</Trans>
                </div>
            ) : (
                <div className="flex items-center gap-2">
                    <BadgeX className="w-4 h-4" />
                    <Trans>Unverified</Trans>
                </div>
            )}
        </Badge>
    );
}
