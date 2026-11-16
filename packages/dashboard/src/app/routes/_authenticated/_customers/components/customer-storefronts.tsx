import { Badge } from '@/vdb/components/ui/badge.js';
import { Trans } from '@lingui/react/macro';

type StorefrontChannel = { id: string; code: string };

/**
 * The Channels in a Customer's identity scope, that is, the storefronts the Customer belongs to.
 * Only shown when Channels have separate customer bases.
 */
export function CustomerStorefronts({ channels }: Readonly<{ channels?: StorefrontChannel[] | null }>) {
    return (
        <div className="flex flex-wrap gap-1">
            {channels?.map(channel => (
                <Badge variant="outline" key={channel.id}>
                    {channel.code}
                </Badge>
            ))}
        </div>
    );
}

export function CustomerStorefrontsHeader() {
    return <Trans>Storefronts</Trans>;
}

export function CustomerStorefrontsCell({
    row,
}: Readonly<{ row: { original: { identityScopeChannels?: StorefrontChannel[] | null } } }>) {
    return <CustomerStorefronts channels={row.original.identityScopeChannels} />;
}
