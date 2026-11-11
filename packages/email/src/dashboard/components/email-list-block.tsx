import { Trans } from '@lingui/react/macro';
import { Badge } from '@vendure/dashboard';

import { EmailOverviewResult } from '../email.graphql';

type EmailInfo = EmailOverviewResult['emailOverview']['emails'][number];

/**
 * The list of configured emails. Selecting one shows its preview.
 */
export function EmailListBlock({
    emails,
    selectedType,
    onSelect,
}: Readonly<{
    emails: EmailInfo[];
    selectedType?: string;
    onSelect: (type: string) => void;
}>) {
    return (
        <nav className="flex flex-col gap-0.5" aria-label="Emails">
            {emails.map(email => {
                const active = email.type === selectedType;
                return (
                    <button
                        key={email.type}
                        type="button"
                        onClick={() => onSelect(email.type)}
                        aria-current={active ? 'page' : undefined}
                        data-testid={`email-list-${email.type}`}
                        className={
                            'flex items-center justify-between gap-2 rounded-md px-2 py-1.5 text-left text-sm transition-colors ' +
                            (active ? 'bg-muted font-medium text-foreground' : 'text-muted-foreground hover:bg-muted/60 hover:text-foreground')
                        }
                    >
                        <span className="truncate">{email.label}</span>
                        {email.canSendFromOrder ? (
                            <Badge variant="secondary" className="shrink-0">
                                <Trans>Order</Trans>
                            </Badge>
                        ) : null}
                    </button>
                );
            })}
        </nav>
    );
}
