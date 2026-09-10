import { ChannelCodeLabel } from '@/vdb/components/shared/channel-code-label.js';
import { ChannelSelector } from '@/vdb/components/shared/channel-selector.js';
import { RoleSelector } from '@/vdb/components/shared/role-selector.js';
import { Button } from '@/vdb/components/ui/button.js';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/vdb/components/ui/table.js';
import { api } from '@/vdb/graphql/api.js';
import { useChannel } from '@/vdb/hooks/use-channel.js';
import { useGrantableRoles } from '@/vdb/hooks/use-grantable-roles.js';
import { usePermissions } from '@/vdb/hooks/use-permissions.js';
import { Trans, useLingui } from '@lingui/react/macro';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Plus, Trash2 } from 'lucide-react';
import { useState } from 'react';
import { toast } from 'sonner';

import { assignRolesToUserDocument, removeRolesFromUserDocument } from '../administrators.graphql.js';

export interface RoleAssignmentRow {
    roleId: string;
    channelId: string;
    role: { code: string; description?: string | null };
    channel: { code: string };
}

export interface RoleAssignmentsTableProps {
    userId: string;
    /**
     * The User's assignments as read from the server (`User.roleAssignments`), which the
     * server has already filtered to the pairs the active user may grant or remove.
     */
    assignments: RoleAssignmentRow[];
}

/**
 * Lists a User's role assignments and edits them as memberships, outside the entity form:
 * adding or removing a pair fires its own mutation and refetches the detail page. Every row
 * shown is one the active user may remove, since the server filters `User.roleAssignments`
 * through the same rule that guards the write (`RoleService.canGrant`), so there is nothing
 * to lock or preserve. Pairs outside the active user's reach are simply not listed.
 */
export function RoleAssignmentsTable({ userId, assignments }: Readonly<RoleAssignmentsTableProps>) {
    const { t } = useLingui();
    const { activeChannel } = useChannel();
    const { hasPermissions } = usePermissions();
    const { nonGrantableRoleIds, grantableChannelIds } = useGrantableRoles();
    const queryClient = useQueryClient();
    // The assign / remove mutations are guarded by UpdateAdministrator on the server,
    // for API-key Users too.
    const canEdit = hasPermissions(['UpdateAdministrator']);
    const [newRoleId, setNewRoleId] = useState('');
    const [pickedChannelIds, setPickedChannelIds] = useState<string[] | undefined>();
    // Start on the active channel, so the common single-channel case is just "pick a role".
    const newChannelIds = pickedChannelIds ?? (activeChannel ? [activeChannel.id] : []);

    const refetchDetail = () => queryClient.invalidateQueries({ queryKey: ['DetailPage'] });

    const { mutate: assignRoles, isPending: assigning } = useMutation({
        mutationFn: api.mutate(assignRolesToUserDocument),
        onSuccess: () => {
            toast.success(t`Role assigned`);
            setNewRoleId('');
            setPickedChannelIds(undefined);
            refetchDetail();
        },
        onError: err => {
            toast.error(t`Failed to assign role`, {
                description: err instanceof Error ? err.message : undefined,
            });
        },
    });

    const { mutate: removeRoles, isPending: removing } = useMutation({
        mutationFn: api.mutate(removeRolesFromUserDocument),
        onSuccess: () => {
            toast.success(t`Role removed`);
            refetchDetail();
        },
        onError: err => {
            toast.error(t`Failed to remove role`, {
                description: err instanceof Error ? err.message : undefined,
            });
        },
    });

    return (
        <div className="flex flex-col gap-4">
            <Table>
                <TableHeader>
                    <TableRow>
                        <TableHead>
                            <Trans>Role</Trans>
                        </TableHead>
                        <TableHead>
                            <Trans>Channel</Trans>
                        </TableHead>
                        {canEdit && <TableHead className="w-12" />}
                    </TableRow>
                </TableHeader>
                <TableBody>
                    {assignments.length === 0 && (
                        <TableRow>
                            <TableCell colSpan={canEdit ? 3 : 2} className="text-muted-foreground">
                                <Trans>No roles assigned</Trans>
                            </TableCell>
                        </TableRow>
                    )}
                    {assignments.map(assignment => (
                        <TableRow key={`${assignment.roleId}|${assignment.channelId}`}>
                            <TableCell>{assignment.role.description || assignment.role.code}</TableCell>
                            <TableCell>
                                <ChannelCodeLabel code={assignment.channel.code} />
                            </TableCell>
                            {canEdit && (
                                <TableCell>
                                    <Button
                                        type="button"
                                        variant="ghost"
                                        size="icon"
                                        aria-label={t`Remove role`}
                                        disabled={removing}
                                        onClick={() =>
                                            removeRoles({
                                                input: {
                                                    userId,
                                                    assignments: [
                                                        {
                                                            roleId: assignment.roleId,
                                                            channelId: assignment.channelId,
                                                        },
                                                    ],
                                                },
                                            })
                                        }
                                    >
                                        <Trash2 className="h-4 w-4" />
                                    </Button>
                                </TableCell>
                            )}
                        </TableRow>
                    ))}
                </TableBody>
            </Table>
            {canEdit && (
                <div className="flex items-start gap-2">
                    <div className="flex-1">
                        <RoleSelector
                            multiple={false}
                            value={newRoleId}
                            onChange={setNewRoleId}
                            excludeIds={nonGrantableRoleIds(newChannelIds)}
                        />
                    </div>
                    <div className="flex-[2]">
                        <ChannelSelector
                            multiple={true}
                            value={newChannelIds}
                            onChange={setPickedChannelIds}
                            includeIds={grantableChannelIds(newRoleId || undefined)}
                            ownChannelsOnly
                        />
                    </div>
                    <Button
                        type="button"
                        variant="outline"
                        disabled={!newRoleId || newChannelIds.length === 0 || assigning}
                        onClick={() =>
                            assignRoles({
                                input: {
                                    userId,
                                    assignments: newChannelIds.map(channelId => ({
                                        roleId: newRoleId,
                                        channelId,
                                    })),
                                },
                            })
                        }
                    >
                        <Plus className="h-4 w-4" />
                        <Trans>Assign role</Trans>
                    </Button>
                </div>
            )}
        </div>
    );
}
