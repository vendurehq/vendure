import { Trans, useLingui } from '@lingui/react/macro';
import { useId, useRef } from 'react';

import { ChannelCodeLabel } from '@/vdb/components/shared/channel-code-label.js';
import { Field, FieldDescription, FieldLabel } from '@/vdb/components/ui/field.js';
import { StatusBadge, type Tone } from '@/vdb/components/ui/status-badge.js';
import { Switch } from '@/vdb/components/ui/switch.js';
import { DEFAULT_CHANNEL_CODE } from '@/vdb/constants.js';
import { useChannel } from '@/vdb/hooks/use-channel.js';

/**
 * @description
 * Whether a Product or ProductVariant is available in the active Channel, and why not:
 *
 * - `enabled`: enabled, and not hidden in the active Channel.
 * - `hidden`: enabled, but hidden in the active Channel (`enabledInChannel` is `false`).
 * - `disabled`: disabled, so unavailable in every Channel whatever its per-channel value.
 *
 * @docsCategory components
 * @since 4.0.0
 */
export type ChannelAvailability = 'enabled' | 'hidden' | 'disabled';

/**
 * @description
 * Combines the global `enabled` value of a Product or ProductVariant with its `enabledInChannel`
 * value in the active Channel, following the server's rule: it is available in a Channel only if
 * it is enabled and not disabled in that Channel.
 *
 * @docsCategory components
 * @since 4.0.0
 */
export function getChannelAvailability(
    enabled: boolean | null | undefined,
    enabledInChannel: boolean | null | undefined,
): ChannelAvailability {
    if (!enabled) {
        return 'disabled';
    }
    return enabledInChannel === false ? 'hidden' : 'enabled';
}

const availabilityTone: Record<ChannelAvailability, Tone> = {
    enabled: 'success',
    hidden: 'warning',
    disabled: 'neutral',
};

function useAvailabilityLabels() {
    const { t } = useLingui();
    const { activeChannel } = useChannel();
    const channelName =
        activeChannel?.code === DEFAULT_CHANNEL_CODE ? t`Default channel` : (activeChannel?.code ?? '');
    return {
        label: {
            enabled: t`Enabled`,
            hidden: t`Hidden`,
            disabled: t`Disabled`,
        } satisfies Record<ChannelAvailability, string>,
        title: {
            enabled: t`Available in ${channelName}`,
            hidden: t`Enabled, but hidden in ${channelName}`,
            disabled: t`Disabled in every channel`,
        } satisfies Record<ChannelAvailability, string>,
    };
}

/**
 * @description
 * Displays whether a Product or ProductVariant is available in the active Channel: "Enabled",
 * "Hidden" (enabled, but hidden in this Channel) or "Disabled".
 *
 * @docsCategory components
 * @since 4.0.0
 */
export function ChannelAvailabilityBadge({
    enabled,
    enabledInChannel,
}: Readonly<{ enabled: boolean | null | undefined; enabledInChannel: boolean | null | undefined }>) {
    const { label, title } = useAvailabilityLabels();
    const availability = getChannelAvailability(enabled, enabledInChannel);
    return (
        <StatusBadge tone={availabilityTone[availability]} title={title[availability]}>
            {label[availability]}
        </StatusBadge>
    );
}

/**
 * @description
 * A switch that hides a Product or ProductVariant in the active Channel only (its
 * `enabledInChannel` value). Meant for a side block of a detail page, next to the global
 * "Enabled" switch in the page header, whose value it takes as `enabled`: while that is off, the
 * help text says the entity is unavailable in every Channel.
 *
 * Turning the switch off sets the value to `false`; turning it back on restores the value it had
 * before (`null` or `true`, which have the same effect), or `null`.
 *
 * @docsCategory components
 * @since 4.0.0
 */
export function ChannelAvailabilityControl({
    enabled,
    value,
    onChange,
    disabled,
}: Readonly<{
    enabled: boolean | null | undefined;
    value: boolean | null | undefined;
    onChange: (value: boolean | null) => void;
    disabled?: boolean;
}>) {
    const { activeChannel } = useChannel();
    const switchId = useId();
    // `true` and `null` have the same effect, so turning the switch back on restores whichever
    // it had, rather than making the form dirty with no change.
    const visibleValue = useRef<boolean | null>(null);
    if (value !== false) {
        visibleValue.current = value ?? null;
    }
    const channel = <ChannelCodeLabel code={activeChannel?.code} />;

    return (
        <Field className="gap-1.5" data-testid="channel-availability">
            <div className="flex items-center justify-between gap-3">
                <FieldLabel htmlFor={switchId}>
                    <Trans>Visible in this channel</Trans>
                </FieldLabel>
                <Switch
                    id={switchId}
                    checked={value !== false}
                    disabled={disabled}
                    onCheckedChange={checked => onChange(checked ? visibleValue.current : false)}
                />
            </div>
            <FieldDescription>
                {enabled ? (
                    <Trans>Hide it in {channel} without affecting other channels.</Trans>
                ) : (
                    <Trans>Disabled in every channel. This setting applies once it is enabled.</Trans>
                )}
            </FieldDescription>
        </Field>
    );
}

/**
 * @description
 * The id of the "Status" faceted filter that {@link useChannelAvailabilityFilter} adds to the
 * Product and ProductVariant lists. It is not a field of the list query: register a hidden
 * column with this id (`additionalColumns`) and pass {@link transformChannelAvailabilityFilter}
 * as `transformVariables`, which turns it into a filter on `enabled` and `enabledInChannel`.
 *
 * @docsCategory components
 * @since 4.0.0
 */
export const CHANNEL_AVAILABILITY_FILTER_ID = 'channelAvailability';

const availabilityFilters: Record<ChannelAvailability, Record<string, unknown>> = {
    enabled: {
        _and: [
            { enabled: { eq: true } },
            { _or: [{ enabledInChannel: { isNull: true } }, { enabledInChannel: { eq: true } }] },
        ],
    },
    hidden: { _and: [{ enabled: { eq: true } }, { enabledInChannel: { eq: false } }] },
    disabled: { enabled: { eq: false } },
};

/**
 * @description
 * A `transformVariables` function for a Product or ProductVariant list which replaces the
 * "Status" faceted filter (see {@link CHANNEL_AVAILABILITY_FILTER_ID}) with the matching filter on
 * `enabled` and `enabledInChannel`.
 *
 * @docsCategory components
 * @since 4.0.0
 */
export function transformChannelAvailabilityFilter<V>(variables: V): V {
    const options = (variables as { options?: { filter?: { _and?: Array<Record<string, any>> } } }).options;
    const conditions = options?.filter?._and;
    if (!options?.filter || !conditions?.some(c => CHANNEL_AVAILABILITY_FILTER_ID in c)) {
        return variables;
    }
    const _and = conditions.map(condition => {
        const selected = condition[CHANNEL_AVAILABILITY_FILTER_ID]?.in as ChannelAvailability[] | undefined;
        if (!selected) {
            return condition;
        }
        return { _or: selected.filter(a => a in availabilityFilters).map(a => availabilityFilters[a]) };
    });
    return { ...variables, options: { ...options, filter: { ...options.filter, _and } } };
}

/**
 * @description
 * Returns the props a Product or ProductVariant `ListPage` needs for the "Status" faceted filter
 * (enabled, hidden in the active Channel, disabled), or `undefined` for the faceted filter when
 * there is only one Channel.
 *
 * @docsCategory components
 * @since 4.0.0
 */
export function useChannelAvailabilityFilter() {
    const { t } = useLingui();
    const { channels } = useChannel();
    const facetedFilter =
        channels.length > 1
            ? {
                  title: t`Status`,
                  options: [
                      { label: t`Enabled`, value: 'enabled' },
                      { label: t`Hidden in this channel`, value: 'hidden' },
                      { label: t`Disabled`, value: 'disabled' },
                  ],
              }
            : undefined;
    const filterColumn = {
        header: '',
        cell: () => null,
        enableSorting: false,
        enableHiding: false,
        enableColumnFilter: false,
    };
    return { facetedFilter, filterColumn, transformVariables: transformChannelAvailabilityFilter };
}
