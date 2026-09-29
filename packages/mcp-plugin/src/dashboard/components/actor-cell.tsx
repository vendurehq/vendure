import { Trans } from '@lingui/react/macro';
import { DetailPageButton } from '@vendure/dashboard';

import { EmptyCell } from './empty-cell';

// Customers link to their customer page; administrators have no such page, so they show as plain text.
export function ActorCell({
    actorType,
    actorName,
    customerId,
}: {
    actorType: string | null;
    actorName: string | null;
    customerId: string | null;
}) {
    if (actorType === 'anonymous') {
        return (
            <span className="text-sm text-muted-foreground">
                <Trans>Anonymous</Trans>
            </span>
        );
    }
    // A missing name means the account was deleted since, not that nobody was signed in.
    if (!actorName) {
        return <EmptyCell />;
    }
    if (customerId) {
        return <DetailPageButton href={`/customers/${customerId}`} label={actorName} className="px-0" />;
    }
    return <span className="text-sm">{actorName}</span>;
}
