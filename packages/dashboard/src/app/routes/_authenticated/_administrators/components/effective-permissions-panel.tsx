import { ChannelCodeLabel } from '@/vdb/components/shared/channel-code-label.js';
import { MultiSelect } from '@/vdb/components/shared/multi-select.js';
import { useChannel } from '@/vdb/hooks/use-channel.js';
import { useRoles } from '@/vdb/hooks/use-roles.js';
import { Trans } from '@lingui/react/macro';
import { ReactNode, useState } from 'react';

import { RoleAssignmentPair, useRoleAssignmentLabels } from './role-assignments-editor.js';
import { RolePermissionsDisplay } from './role-permissions-display.js';

export interface EffectivePermissionsPanelProps {
    assignments: RoleAssignmentPair[];
    /**
     * Caption under the heading, naming whose permissions are shown. Owned by the calling
     * page, since the panel is shared between the administrator and API key detail pages.
     */
    description: ReactNode;
}

/**
 * Shows the permissions a User holds on one Channel: the union of the Roles assigned to them
 * there. Permissions are only meaningful per Channel under the role assignment model, so the
 * Channel is picked explicitly rather than the Roles being unioned across all of them.
 */
export function EffectivePermissionsPanel({
    assignments,
    description,
}: Readonly<EffectivePermissionsPanelProps>) {
    const { channels, activeChannel } = useChannel();
    const { roles } = useRoles();
    const assignmentLabels = useRoleAssignmentLabels(assignments);
    const [pickedChannelId, setPickedChannelId] = useState<string | undefined>();

    // The generated form can hold incomplete pairs (blank seed item, a row mid-edit).
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
            assignmentLabels.channels.get(channelId) ??
            channelId;
        return { value: channelId, label: code, display: <ChannelCodeLabel code={code} /> };
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
            <p className="text-sm text-muted-foreground">{description}</p>
            <RolePermissionsDisplay value={roleIds} />
        </div>
    );
}
