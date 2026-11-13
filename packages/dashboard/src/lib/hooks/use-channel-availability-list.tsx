import { Trans, useLingui } from '@lingui/react/macro';

import { ChannelAvailabilityBadge } from '@/vdb/components/shared/channel-availability.js';
import { ColumnDefWithMetaDependencies } from '@/vdb/components/shared/paginated-list-data-table.js';
import { useChannel } from '@/vdb/hooks/use-channel.js';

// Not a field of the list query: the faceted filter is turned into a filter on `enabled` and
// `enabledInChannel` by `transformVariables` below.
const FILTER_ID = 'channelAvailability';

const availabilityFilters: Record<'enabled' | 'hidden' | 'disabled', Record<string, unknown>> = {
    enabled: { _and: [{ enabled: { eq: true } }, { enabledInChannel: { eq: true } }] },
    hidden: { _and: [{ enabled: { eq: true } }, { enabledInChannel: { eq: false } }] },
    disabled: { enabled: { eq: false } },
};

function transformChannelAvailabilityFilter<V>(variables: V): V {
    const options = (variables as { options?: { filter?: { _and?: Array<Record<string, any>> } } }).options;
    const conditions = options?.filter?._and;
    if (!options?.filter || !conditions?.some(c => FILTER_ID in c)) {
        return variables;
    }
    const _and = conditions.map(condition => {
        const selected = condition[FILTER_ID]?.in as string[] | undefined;
        if (!selected) {
            return condition;
        }
        return {
            _or: selected
                .filter((a): a is keyof typeof availabilityFilters => a in availabilityFilters)
                .map(a => availabilityFilters[a]),
        };
    });
    return { ...variables, options: { ...options, filter: { ...options.filter, _and } } };
}

/**
 * @description
 * Returns what a Product or ProductVariant `ListPage` needs to show whether each row is available
 * in the active Channel. With more than one Channel:
 *
 * - `statusColumn` (for `customizeColumns.enabled`) turns the Enabled column into a Status column
 *   showing a {@link ChannelAvailabilityBadge}: Enabled, Hidden (in this Channel) or Disabled.
 * - `facetedFilter` (for `facetedFilters[filterId]`) is a matching Status filter. It needs a
 *   hidden column registered under `filterId` (`additionalColumns[filterId] = filterColumn`) and
 *   `transformVariables`, which turns it into a filter on `enabled` and `enabledInChannel`.
 *
 * With a single Channel, `statusColumn` is empty and `facetedFilter` is `undefined`, so the list
 * keeps its Enabled column.
 *
 * @example
 * ```tsx
 * const channelAvailability = useChannelAvailabilityList();
 * <ListPage
 *     customizeColumns={{
 *         enabled: channelAvailability.statusColumn,
 *         enabledInChannel: channelAvailability.enabledInChannelColumn,
 *     }}
 *     additionalColumns={{ [channelAvailability.filterId]: channelAvailability.filterColumn }}
 *     facetedFilters={{ [channelAvailability.filterId]: channelAvailability.facetedFilter }}
 *     transformVariables={channelAvailability.transformVariables}
 *     ...
 * />
 * ```
 *
 * @docsCategory hooks
 * @since 4.0.0
 */
export function useChannelAvailabilityList() {
    const { t } = useLingui();
    const { channels } = useChannel();
    const multiChannel = channels.length > 1;
    const statusColumn: ColumnDefWithMetaDependencies<any> = multiChannel
        ? {
              header: () => <Trans>Status</Trans>,
              meta: { dependencies: ['enabledInChannel'] },
              cell: ({ row }) => (
                  <ChannelAvailabilityBadge
                      enabled={row.original.enabled}
                      enabledInChannel={row.original.enabledInChannel}
                  />
              ),
          }
        : {};
    // Shown through the Status column only
    const enabledInChannelColumn: ColumnDefWithMetaDependencies<any> = {
        enableHiding: false,
        enableColumnFilter: false,
    };
    const filterColumn: ColumnDefWithMetaDependencies<any> = {
        header: '',
        cell: () => null,
        enableSorting: false,
        enableHiding: false,
        enableColumnFilter: false,
    };
    const facetedFilter = multiChannel
        ? {
              title: t`Status`,
              options: [
                  { label: t`Enabled`, value: 'enabled' },
                  { label: t`Hidden in this channel`, value: 'hidden' },
                  { label: t`Disabled`, value: 'disabled' },
              ],
          }
        : undefined;
    return {
        statusColumn,
        enabledInChannelColumn,
        filterId: FILTER_ID,
        filterColumn,
        facetedFilter,
        transformVariables: transformChannelAvailabilityFilter,
    };
}
