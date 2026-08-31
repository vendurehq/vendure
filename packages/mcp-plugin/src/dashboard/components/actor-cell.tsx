import { Trans } from '@lingui/react/macro';
import { DetailPageButton } from '@vendure/dashboard';

import { EmptyCell } from './empty-cell';

/**
 * The person a tool call ran as, or the person who approved a grant. Customers link through to
 * their customer page the way the order list does; administrators have no such page, so their
 * name is plain text.
 */
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
    // A name is missing when the account has since been deleted, so the row keeps its dash
    // rather than claiming nobody was signed in.
    if (!actorName) {
        return <EmptyCell />;
    }
    if (customerId) {
        return <DetailPageButton href={`/customers/${customerId}`} label={actorName} className="px-0" />;
    }
    return <span className="text-sm">{actorName}</span>;
}
