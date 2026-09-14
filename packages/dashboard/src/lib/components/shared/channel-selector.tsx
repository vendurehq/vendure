import { api } from '@/vdb/graphql/api.js';
import { graphql } from '@/vdb/graphql/graphql.js';
import { useChannel } from '@/vdb/hooks/use-channel.js';
import { useLingui } from '@lingui/react/macro';
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
}

export function ChannelSelector<T extends boolean>(props: ChannelSelectorProps<T>) {
    const { value, onChange, multiple, includeIds, ownChannelsOnly } = props;
    const { t } = useLingui();
    const { channels: userChannels } = useChannel();

    const { data: channelsData } = useQuery({
        queryKey: ['channels'],
        queryFn: () => api.query(channelsDocument, {}),
        staleTime: 1000 * 60 * 5,
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

    return (
        <MultiSelect
            value={value}
            onChange={onChange}
            multiple={multiple}
            items={items}
            placeholder={t`Select a channel`}
            searchPlaceholder={t`Search channels...`}
        />
    );
}
