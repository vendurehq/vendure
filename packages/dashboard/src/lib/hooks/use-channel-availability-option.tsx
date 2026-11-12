import { Trans } from '@lingui/react/macro';
import { ReactNode, useId, useState } from 'react';

import { ChannelCodeLabel } from '@/vdb/components/shared/channel-code-label.js';
import { Field, FieldLabel, FieldLegend, FieldSet } from '@/vdb/components/ui/field.js';
import { RadioGroup, RadioGroupItem } from '@/vdb/components/ui/radio-group.js';
import { useChannel } from '@/vdb/hooks/use-channel.js';

type ChannelAvailabilityOption = 'copy' | 'visible' | 'hidden';

/**
 * @description
 * The per-channel visibility option of the assign-to-channel dialogs of Products and
 * ProductVariants: keep the visibility they have in the active Channel (the default), or make them
 * visible or hidden in the new Channels. Pass `channelAvailabilityField` to the dialog's
 * additional fields and `enabledInChannel` to the mutation input.
 *
 * `enabledInChannel` is `undefined` for the default, which leaves it out of the mutation input so
 * that the server copies the value from the active Channel; `true` for visible; and `false` for
 * hidden. `channelAvailabilityField` is `null` when there is only one Channel.
 *
 * @example
 * ```tsx
 * const { enabledInChannel, channelAvailabilityField } = useChannelAvailabilityOption();
 * ```
 *
 * @docsCategory hooks
 * @since 4.0.0
 */
export function useChannelAvailabilityOption() {
    const { activeChannel, channels } = useChannel();
    const idPrefix = useId();
    const [option, setOption] = useState<ChannelAvailabilityOption>('copy');
    const enabledInChannel = option === 'copy' ? undefined : option === 'visible';
    const items: Array<{ key: ChannelAvailabilityOption; label: ReactNode }> = [
        {
            key: 'copy',
            label: (
                <Trans>
                    Same as in <ChannelCodeLabel code={activeChannel?.code} />
                </Trans>
            ),
        },
        { key: 'visible', label: <Trans>Visible</Trans> },
        { key: 'hidden', label: <Trans>Hidden</Trans> },
    ];

    const channelAvailabilityField =
        channels.length > 1 ? (
            <FieldSet className="gap-3" data-testid="assign-channel-availability">
                <FieldLegend variant="label" className="mb-2">
                    <Trans>Visibility in the new channels</Trans>
                </FieldLegend>
                <RadioGroup
                    value={option}
                    onValueChange={value => setOption(value as ChannelAvailabilityOption)}
                    className="gap-2.5"
                >
                    {items.map(item => (
                        <Field key={item.key} orientation="horizontal" className="gap-2">
                            <RadioGroupItem value={item.key} id={`${idPrefix}-${item.key}`} />
                            <FieldLabel htmlFor={`${idPrefix}-${item.key}`} className="font-normal">
                                {item.label}
                            </FieldLabel>
                        </Field>
                    ))}
                </RadioGroup>
            </FieldSet>
        ) : null;

    return { enabledInChannel, channelAvailabilityField };
}
