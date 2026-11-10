import { Button } from '@/vdb/components/ui/button.js';
import { api } from '@/vdb/graphql/api.js';
import { graphql } from '@/vdb/graphql/graphql.js';
import { useChannel } from '@/vdb/hooks/use-channel.js';
import { Trans, useLingui } from '@lingui/react/macro';
import { useQuery } from '@tanstack/react-query';
import { ChannelCodeLabel } from './channel-code-label.js';
import { MultiSelect } from './multi-select.js';

const channelsDocument = graphql(`
    query channels($options: ChannelListOptions) {
        channels(options: $options) {
            items {
                id
                code
            }
        }
    }
`);

export interface ChannelSelectorProps<T extends boolean> {
    value: T extends true ? string[] : string;
    onChange: (value: T extends true ? string[] : string) => void;
    multiple?: T;
    /**
     * Channel ids to restrict the list to. An allowlist rather than an exclusion list, so
     * that a Channel the caller knows nothing about is never offered.
     */
    includeIds?: string[];
    /**
     * Build the options from the active user's own Channels (`me.channels`) instead of the
     * `channels` query, which is FORBIDDEN for administrators without `ReadChannel` or
     * `ReadSettings`. Flows restricted to grantable Channels never need to offer a Channel
     * outside the user's own set.
     */
    ownChannelsOnly?: boolean;
    /**
     * For a multi-select: offer "Select all" and "Clear" under the picker, acting on the
     * Channels the picker offers (after `includeIds`), so a Role can be granted on every
     * grantable Channel in one step.
     */
    showSelectAll?: boolean;
}

/**
 * Selected Channels shown as chips in a multi-select before the rest collapse into "+N more".
 */
const MAX_VISIBLE_CHANNEL_CHIPS = 8;

export function ChannelSelector<T extends boolean>(props: ChannelSelectorProps<T>) {
    const { value, onChange, multiple, includeIds, ownChannelsOnly, showSelectAll } = props;
    const { t } = useLingui();
    const { channels: userChannels } = useChannel();

    const { data: channelsData } = useQuery({
        queryKey: ['channels'],
        // TODO: without `take` the server returns up to `adminListQueryLimit` Channels (1000
        // by default), so an instance with more silently loses the rest here. An explicit
        // `take` above a lowered limit is rejected, so paginate or switch to server-side search.
        queryFn: () => api.query(channelsDocument, {}),
        enabled: !ownChannelsOnly,
    });

    const channels = ownChannelsOnly ? userChannels : (channelsData?.channels.items ?? []);

    const items = channels
        .filter(channel => !includeIds || includeIds.includes(channel.id))
        .map(channel => ({
            value: channel.id,
            label: channel.code,
            display: <ChannelCodeLabel code={channel.code} />,
        }));

    const picker = (
        <MultiSelect
            value={value}
            onChange={onChange}
            multiple={multiple}
            items={items}
            placeholder={t`Select a channel`}
            searchPlaceholder={t`Search channels...`}
            maxVisibleChips={multiple ? MAX_VISIBLE_CHANNEL_CHIPS : undefined}
        />
    );
    if (!multiple || !showSelectAll || items.length < 2) {
        return picker;
    }
    const selectedIds = value as string[];
    const allSelected = items.every(item => selectedIds.includes(item.value));
    const setSelection = (ids: string[]) => onChange(ids as T extends true ? string[] : string);
    return (
        <div className="flex flex-col gap-1">
            {picker}
            <div className="flex gap-1">
                {!allSelected && (
                    <Button
                        type="button"
                        variant="link"
                        size="sm"
                        className="h-auto px-0"
                        onClick={() => setSelection(items.map(item => item.value))}
                    >
                        <Trans>Select all ({items.length})</Trans>
                    </Button>
                )}
                {selectedIds.length > 0 && (
                    <Button
                        type="button"
                        variant="link"
                        size="sm"
                        className="h-auto px-2 text-muted-foreground"
                        onClick={() => setSelection([])}
                    >
                        <Trans>Clear</Trans>
                    </Button>
                )}
            </div>
        </div>
    );
}
