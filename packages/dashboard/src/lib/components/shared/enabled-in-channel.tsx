import { Trans, useLingui } from '@lingui/react/macro';

import { ChannelCodeLabel } from '@/vdb/components/shared/channel-code-label.js';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/vdb/components/ui/select.js';
import { StatusBadge } from '@/vdb/components/ui/status-badge.js';
import { useChannel } from '@/vdb/hooks/use-channel.js';

type SelectValueKey = 'unset' | 'enabled' | 'disabled';

function toKey(value: boolean | null | undefined): SelectValueKey {
    return value === true ? 'enabled' : value === false ? 'disabled' : 'unset';
}

function fromKey(key: SelectValueKey): boolean | null {
    return key === 'enabled' ? true : key === 'disabled' ? false : null;
}

/**
 * @description
 * Edits the per-channel `enabledInChannel` value of a Product or ProductVariant in the active
 * Channel: not set, enabled or disabled. The entity is available in a Channel only if it is
 * enabled globally and not disabled in that Channel.
 *
 * Renders nothing when there is only one Channel.
 *
 * @docsCategory components
 * @since 4.0.0
 */
export function EnabledInChannelSelect({
    value,
    onChange,
    testId,
}: Readonly<{
    value: boolean | null | undefined;
    onChange: (value: boolean | null) => void;
    testId?: string;
}>) {
    const { t } = useLingui();
    const { channels, activeChannel } = useChannel();
    if (channels.length < 2) {
        return null;
    }
    const items: Record<SelectValueKey, string> = {
        unset: t`Not set`,
        enabled: t`Enabled`,
        disabled: t`Disabled`,
    };
    return (
        <div
            className="flex items-center gap-2"
            title={t`Enables or disables it in this channel only. When not set, the global setting applies.`}
            data-testid={testId}
        >
            <span className="text-sm font-medium whitespace-nowrap">
                <Trans>
                    In <ChannelCodeLabel code={activeChannel?.code ?? ''} />
                </Trans>
            </span>
            <Select
                items={items}
                value={toKey(value)}
                onValueChange={key => {
                    if (key != null) {
                        onChange(fromKey(key as SelectValueKey));
                    }
                }}
            >
                <SelectTrigger className="w-[120px]">
                    <SelectValue />
                </SelectTrigger>
                <SelectContent>
                    {(Object.keys(items) as SelectValueKey[]).map(key => (
                        <SelectItem key={key} value={key}>
                            {items[key]}
                        </SelectItem>
                    ))}
                </SelectContent>
            </Select>
        </div>
    );
}

/**
 * @description
 * Displays a per-channel `enabledInChannel` value in a list: not set, enabled or disabled.
 *
 * @docsCategory components
 * @since 4.0.0
 */
export function EnabledInChannelBadge({ value }: Readonly<{ value: boolean | null | undefined }>) {
    const { t } = useLingui();
    if (value == null) {
        return <span className="text-muted-foreground text-sm">{t`Not set`}</span>;
    }
    return <StatusBadge tone={value ? 'success' : 'warning'}>{value ? t`Enabled` : t`Disabled`}</StatusBadge>;
}
