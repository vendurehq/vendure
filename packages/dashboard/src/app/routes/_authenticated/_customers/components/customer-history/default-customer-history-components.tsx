import { HistoryEntry, HistoryEntryProps } from '@/vdb/framework/history-entry/history-entry.js';
import { Trans } from '@lingui/react/macro';

export function CustomerRegisteredOrVerifiedComponent(props: Readonly<HistoryEntryProps>) {
    const { entry } = props;
    const strategy = entry.data?.strategy || 'native';

    return (
        <HistoryEntry {...props}>
            <div className="space-y-1">
                {strategy === 'native' ? (
                    <p className="text-xs text-muted-foreground">
                        <Trans>Using native authentication strategy</Trans>
                    </p>
                ) : (
                    <p className="text-xs text-muted-foreground">
                        <Trans>Using external authentication strategy: {strategy}</Trans>
                    </p>
                )}
            </div>
        </HistoryEntry>
    );
}

export function CustomerDetailUpdatedComponent(props: Readonly<HistoryEntryProps>) {
    const { entry } = props;
    return (
        <HistoryEntry {...props}>
            <div className="space-y-2">
                {entry.data?.input && (
                    <details className="text-xs">
                        <summary className="cursor-pointer text-muted-foreground hover:text-foreground">
                            <Trans>View changes</Trans>
                        </summary>
                        <pre className="mt-2 p-2 bg-muted rounded text-xs overflow-auto">
                            {JSON.stringify(entry.data.input, null, 2)}
                        </pre>
                    </details>
                )}
            </div>
        </HistoryEntry>
    );
}

export function CustomerAddRemoveGroupComponent(props: Readonly<HistoryEntryProps>) {
    const { entry } = props;
    const groupName = entry.data?.groupName || 'Unknown Group';

    return (
        <HistoryEntry {...props}>
            <p className="text-xs text-muted-foreground">{groupName}</p>
        </HistoryEntry>
    );
}

export function CustomerAddressCreatedComponent(props: Readonly<HistoryEntryProps>) {
    const { entry } = props;
    return (
        <HistoryEntry {...props}>
            <div className="space-y-1">
                <p className="text-xs text-muted-foreground">
                    <Trans>Address created</Trans>
                </p>
                {entry.data?.address && (
                    <div className="text-xs p-2 bg-muted rounded">{entry.data.address}</div>
                )}
            </div>
        </HistoryEntry>
    );
}

export function CustomerAddressUpdatedComponent(props: Readonly<HistoryEntryProps>) {
    const { entry } = props;
    return (
        <HistoryEntry {...props}>
            <div className="space-y-2">
                <p className="text-xs text-muted-foreground">
                    <Trans>Address updated</Trans>
                </p>
                {entry.data?.address && (
                    <div className="text-xs p-2 bg-muted rounded">{entry.data.address}</div>
                )}
                {entry.data?.input && (
                    <details className="text-xs">
                        <summary className="cursor-pointer text-muted-foreground hover:text-foreground">
                            <Trans>View changes</Trans>
                        </summary>
                        <pre className="mt-2 p-2 bg-muted rounded text-xs overflow-auto">
                            {JSON.stringify(entry.data.input, null, 2)}
                        </pre>
                    </details>
                )}
            </div>
        </HistoryEntry>
    );
}

export function CustomerAddressDeletedComponent(props: Readonly<HistoryEntryProps>) {
    const { entry } = props;
    return (
        <HistoryEntry {...props}>
            <div className="space-y-1">
                <p className="text-xs text-muted-foreground">
                    <Trans>Address deleted</Trans>
                </p>
                {entry.data?.address && (
                    <div className="text-xs p-2 bg-muted rounded">{entry.data.address}</div>
                )}
            </div>
        </HistoryEntry>
    );
}

export function CustomerPasswordUpdatedComponent(props: Readonly<HistoryEntryProps>) {
    return (
        <HistoryEntry {...props}>
            <p className="text-xs text-muted-foreground">
                <Trans>Password updated</Trans>
            </p>
        </HistoryEntry>
    );
}

export function CustomerPasswordResetRequestedComponent(props: Readonly<HistoryEntryProps>) {
    return (
        <HistoryEntry {...props}>
            <p className="text-xs text-muted-foreground">
                <Trans>Password reset requested</Trans>
            </p>
        </HistoryEntry>
    );
}

export function CustomerPasswordResetVerifiedComponent(props: Readonly<HistoryEntryProps>) {
    return (
        <HistoryEntry {...props}>
            <p className="text-xs text-muted-foreground">
                <Trans>Password reset verified</Trans>
            </p>
        </HistoryEntry>
    );
}

export function CustomerEmailUpdateComponent(props: Readonly<HistoryEntryProps>) {
    const { oldEmailAddress, newEmailAddress } = props.entry.data || {};

    return (
        <HistoryEntry {...props}>
            <div className="space-y-2">
                {(oldEmailAddress || newEmailAddress) && (
                    <details className="text-xs">
                        <summary className="cursor-pointer text-muted-foreground hover:text-foreground">
                            <Trans>View details</Trans>
                        </summary>
                        <div className="mt-2 space-y-1">
                            {oldEmailAddress && (
                                <div>
                                    <span className="font-medium">
                                        <Trans>Old email:</Trans>
                                    </span>{' '}
                                    {oldEmailAddress}
                                </div>
                            )}
                            {newEmailAddress && (
                                <div>
                                    <span className="font-medium">
                                        <Trans>New email:</Trans>
                                    </span>{' '}
                                    {newEmailAddress}
                                </div>
                            )}
                        </div>
                    </details>
                )}
            </div>
        </HistoryEntry>
    );
}
