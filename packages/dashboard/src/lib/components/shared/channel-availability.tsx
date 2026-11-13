import { Trans, useLingui } from '@lingui/react/macro';
import { useId } from 'react';
import { Control, Controller, FieldValues, Path, useWatch } from 'react-hook-form';

import { ChannelCodeLabel } from '@/vdb/components/shared/channel-code-label.js';
import { Field, FieldDescription, FieldLabel } from '@/vdb/components/ui/field.js';
import { defineStateEntries, StatusBadge } from '@/vdb/components/ui/status-badge.js';
import { Switch } from '@/vdb/components/ui/switch.js';
import { DEFAULT_CHANNEL_CODE } from '@/vdb/constants.js';
import { useChannel } from '@/vdb/hooks/use-channel.js';

/**
 * Whether a Product or ProductVariant is available in the active Channel, and why not. The server
 * makes it available only if it is enabled globally and enabled in the Channel.
 */
type ChannelAvailability = 'enabled' | 'hidden' | 'disabled';

// `enabled` is the healthy state (success); `hidden` is enabled but hidden in this channel only,
// which is worth noticing (warning); `disabled` switches it off everywhere (neutral, an outcome).
const channelAvailabilityDictionary = defineStateEntries<ChannelAvailability>({
    enabled: { tone: 'success', defaultLabel: 'Enabled' },
    hidden: { tone: 'warning', defaultLabel: 'Hidden' },
    disabled: { tone: 'neutral', defaultLabel: 'Disabled' },
});

function getChannelAvailability(enabled: boolean, enabledInChannel: boolean): ChannelAvailability {
    if (!enabled) {
        return 'disabled';
    }
    return enabledInChannel ? 'enabled' : 'hidden';
}

/**
 * @description
 * Displays whether a Product or ProductVariant is available in the active Channel: "Enabled",
 * "Hidden" (enabled, but hidden in this Channel) or "Disabled" (in every Channel).
 *
 * @docsCategory components
 * @since 4.0.0
 */
export function ChannelAvailabilityBadge({
    enabled,
    enabledInChannel,
}: Readonly<{ enabled: boolean; enabledInChannel: boolean }>) {
    const { t } = useLingui();
    const { activeChannel } = useChannel();
    const channelName =
        activeChannel?.code === DEFAULT_CHANNEL_CODE ? t`Default channel` : (activeChannel?.code ?? '');
    const availability = getChannelAvailability(enabled, enabledInChannel);
    const label: Record<ChannelAvailability, string> = {
        enabled: t`Enabled`,
        hidden: t`Hidden`,
        disabled: t`Disabled`,
    };
    const title: Record<ChannelAvailability, string> = {
        enabled: t`Available in ${channelName}`,
        hidden: t`Enabled, but hidden in ${channelName}`,
        disabled: t`Disabled in every channel`,
    };
    return (
        <StatusBadge tone={channelAvailabilityDictionary.toneFor(availability)} title={title[availability]}>
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
 * @docsCategory components
 * @since 4.0.0
 */
export function ChannelAvailabilityControl({
    enabled,
    value,
    onChange,
    disabled,
}: Readonly<{
    enabled: boolean;
    value: boolean;
    onChange: (value: boolean) => void;
    disabled?: boolean;
}>) {
    const { activeChannel } = useChannel();
    const switchId = useId();
    const channel = <ChannelCodeLabel code={activeChannel?.code} />;

    return (
        <Field className="gap-1.5" data-testid="channel-availability">
            <div className="flex items-center justify-between gap-3">
                <FieldLabel htmlFor={switchId}>
                    <Trans>Visible in this channel</Trans>
                </FieldLabel>
                <Switch id={switchId} checked={value} disabled={disabled} onCheckedChange={onChange} />
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
 * A {@link ChannelAvailabilityControl} bound to the `enabledInChannel` field of a Product or
 * ProductVariant detail form, following its `enabled` field. The form must have both fields.
 * Meant as the content of an "Availability" side block, shown only when there is more than one
 * Channel.
 *
 * @docsCategory components
 * @since 4.0.0
 */
export function ChannelAvailabilityFormField<T extends FieldValues>({
    control,
}: Readonly<{ control: Control<T> }>) {
    const enabled = useWatch({ control, name: 'enabled' as Path<T> });
    return (
        <Controller
            control={control}
            name={'enabledInChannel' as Path<T>}
            render={({ field }) => (
                <ChannelAvailabilityControl
                    enabled={!!enabled}
                    value={field.value ?? true}
                    onChange={field.onChange}
                />
            )}
        />
    );
}
