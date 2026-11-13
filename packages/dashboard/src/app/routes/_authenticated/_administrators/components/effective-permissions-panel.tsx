import { MultiSelect } from '@/vdb/components/shared/multi-select.js';
import { DEFAULT_CHANNEL_CODE } from '@/vdb/constants.js';
import { useChannel } from '@/vdb/hooks/use-channel.js';
import { useRoles } from '@/vdb/hooks/use-roles.js';
import { Trans, useLingui } from '@lingui/react/macro';
import { useState } from 'react';

import { RolePermissionsDisplay } from './role-permissions-display.js';

export interface EffectivePermissionsAssignment {
    roleId: string;
    channelId: string;
    /**
     * Rows loaded from the server carry the Channel identity, which labels a Channel the
     * active user cannot read through the channels query. Pairs from the create form do not
     * need it: only the active user's own Channels are offered there.
     */
    channel?: { code: string } | null;
}

export interface EffectivePermissionsPanelProps {
    assignments: EffectivePermissionsAssignment[];
    /**
     * The Channel to show, when the calling page controls it (e.g. a Channel clicked in the
     * assignments table). The picker still lets the user switch to another Channel.
     */
    channelId?: string;
    onChannelChange?: (channelId: string) => void;
}

/**
 * Shows the permissions a User holds on one Channel: the union of the Roles assigned to them
 * there. Permissions are only meaningful per Channel under the role assignment model, so the
 * Channel is picked explicitly rather than the Roles being unioned across all of them.
 */
export function EffectivePermissionsPanel({
    assignments,
    channelId,
    onChannelChange,
}: Readonly<EffectivePermissionsPanelProps>) {
    const { t } = useLingui();
    const { channels, activeChannel } = useChannel();
    const { roles } = useRoles();
    const [localChannelId, setLocalChannelId] = useState<string | undefined>();
    const pickedChannelId = channelId ?? localChannelId;
    const setPickedChannelId = (id: string) => {
        setLocalChannelId(id);
        onChannelChange?.(id);
    };

    // The create form can hold incomplete pairs (a row mid-edit).
    const completeAssignments = assignments.filter(
        assignment => !!assignment?.roleId && !!assignment?.channelId,
    );
    // A Channel where some assigned Role is gate-hidden from the active user would show an
    // incomplete permission list, understating what the user can do there, so it is not
    // offered at all.
    const resolvableRoleIds = new Set(roles.map(role => role.id));
    const channelIdsInUse = Array.from(
        new Set(completeAssignments.map(assignment => assignment.channelId)),
    ).filter(channelId =>
        completeAssignments
            .filter(assignment => assignment.channelId === channelId)
            .every(assignment => resolvableRoleIds.has(assignment.roleId)),
    );
    const selectedChannelId =
        pickedChannelId && channelIdsInUse.includes(pickedChannelId)
            ? pickedChannelId
            : activeChannel && channelIdsInUse.includes(activeChannel.id)
              ? activeChannel.id
              : channelIdsInUse[0];

    if (!selectedChannelId) {
        return null;
    }

    const roleIds = completeAssignments
        .filter(assignment => assignment.channelId === selectedChannelId)
        .map(assignment => assignment.roleId);

    const items = channelIdsInUse.map(channelId => {
        // Fallback for a Channel the active user cannot read through the channels query.
        const code =
            channels.find(channel => channel.id === channelId)?.code ??
            completeAssignments.find(assignment => assignment.channelId === channelId)?.channel?.code ??
            channelId;
        // The label is what the closed picker shows, so it names the default channel as the
        // channel pickers do
        return { value: channelId, label: code === DEFAULT_CHANNEL_CODE ? t`Default channel` : code };
    });

    return (
        <div className="mt-6 flex flex-col gap-2">
            <div className="flex items-center gap-2">
                <span className="text-sm font-medium">
                    <Trans>Effective permissions on</Trans>
                </span>
                <div className="w-64">
                    <MultiSelect
                        multiple={false}
                        value={selectedChannelId}
                        onChange={setPickedChannelId}
                        items={items}
                    />
                </div>
            </div>
            <RolePermissionsDisplay value={roleIds} />
        </div>
    );
}
