import { ChannelCodeLabel } from '@/vdb/components/shared/channel-code-label.js';
import { ChannelSelector } from '@/vdb/components/shared/channel-selector.js';
import { RoleSelector } from '@/vdb/components/shared/role-selector.js';
import { Button } from '@/vdb/components/ui/button.js';
import { Chip } from '@/vdb/components/ui/chip.js';
import { ConfirmDialog } from '@/vdb/components/ui/confirm-dialog.js';
import { Input } from '@/vdb/components/ui/input.js';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/vdb/components/ui/table.js';
import { DEFAULT_CHANNEL_CODE } from '@/vdb/constants.js';
import { api } from '@/vdb/graphql/api.js';
import { useChannel } from '@/vdb/hooks/use-channel.js';
import { useGrantableRoles } from '@/vdb/hooks/use-grantable-roles.js';
import { usePermissions } from '@/vdb/hooks/use-permissions.js';
import { useRoles } from '@/vdb/hooks/use-roles.js';
import { isSuperAdminRole } from '@/vdb/utils/is-super-admin-role.js';
import { Trans, useLingui } from '@lingui/react/macro';
import { useMutation } from '@tanstack/react-query';
import { Plus, Trash2 } from 'lucide-react';
import { useState } from 'react';
import { toast } from 'sonner';

import { assignRolesToUserDocument, removeRolesFromUserDocument } from '../administrators.graphql.js';

export interface RoleAssignmentRow {
    roleId: string;
    channelId: string;
    role: { code: string; description?: string | null; permissions: readonly string[] };
    channel: { code: string };
}

export interface RoleAssignmentsTableProps {
    userId: string;
    /**
     * The User's assignments as read from the server (`User.roleAssignments`), which the
     * server has already filtered to the pairs the active user may grant or remove.
     */
    assignments: RoleAssignmentRow[];
    /**
     * Set for the User of an API key: the Channels the key belongs to. The server refuses
     * grants of the SuperAdmin Role and grants on other Channels for an API key, so they are
     * not offered.
     */
    apiKeyChannelIds?: string[];
    /**
     * Called after an assignment was added or removed, to refetch the User's assignments.
     */
    onChange: () => void;
    /**
     * Called when a Channel of an assignment is clicked, to show the permissions held there.
     */
    onChannelSelect?: (channelId: string) => void;
}

interface RoleGroup {
    roleId: string;
    role: RoleAssignmentRow['role'];
    channels: Array<{ channelId: string; code: string }>;
}

/**
 * The number of Channel chips a Role row shows before collapsing the rest behind "+N more".
 */
const VISIBLE_CHANNELS = 12;
/**
 * From this many assignments on, the table gets a filter input.
 */
const FILTER_THRESHOLD = 10;

/**
 * Lists a User's role assignments and edits them as memberships, outside the entity form:
 * adding or removing a pair fires its own mutation, then calls `onChange` to refetch. Every pair
 * shown is one the active user may remove, since the server filters `User.roleAssignments`
 * through the same rule that guards the write (`RoleService.canGrant`), so there is nothing
 * to lock or preserve. Pairs outside the active user's reach are simply not listed.
 *
 * The pairs are shown as one row per Role, with the Channels it is held on as removable chips.
 * A User granted one Role on many Channels (a marketplace support role on every vendor
 * Channel) then takes one row instead of one row per Channel. Each chip still removes a single
 * pair, since the writes are deltas.
 *
 * The SuperAdmin Role is stored as a single assignment on the default Channel which stands
 * for every Channel, so its row reads "All channels" and its assign row offers no Channel.
 */
export function RoleAssignmentsTable({
    userId,
    assignments,
    apiKeyChannelIds,
    onChange,
    onChannelSelect,
}: Readonly<RoleAssignmentsTableProps>) {
    const { t } = useLingui();
    const { activeChannel } = useChannel();
    const { hasPermissions } = usePermissions();
    const { roles } = useRoles();
    const { nonGrantableRoleIds, grantableChannelIds } = useGrantableRoles();
    // The assign / remove mutations are guarded by UpdateAdministrator on the server,
    // for API-key Users too.
    const canEdit = hasPermissions(['UpdateAdministrator']);
    const [newRoleId, setNewRoleId] = useState('');
    const [pickedChannelIds, setPickedChannelIds] = useState<string[] | undefined>();
    const [filter, setFilter] = useState('');
    const [expandedRoleIds, setExpandedRoleIds] = useState<Set<string>>(new Set());
    const [roleToRemove, setRoleToRemove] = useState<RoleGroup | undefined>();
    // The assign row stays behind an "Add role" button, so that viewing a User's roles shows
    // only the roles.
    const [adding, setAdding] = useState(false);
    const closeAddRow = () => {
        setAdding(false);
        setNewRoleId('');
        setPickedChannelIds(undefined);
    };
    // Start on the active channel, so the common single-channel case is just "pick a role".
    const newChannelIds = pickedChannelIds ?? (activeChannel ? [activeChannel.id] : []);
    const newRoleIsSuperAdmin = isSuperAdminRole(roles.find(role => role.id === newRoleId));
    // A SuperAdmin grant names no Channel: one pair on the active channel is enough, the
    // server stores it as the single default-channel row whichever Channel it names.
    const newAssignments =
        newRoleIsSuperAdmin && activeChannel
            ? [{ roleId: newRoleId, channelId: activeChannel.id }]
            : newChannelIds.map(channelId => ({ roleId: newRoleId, channelId }));

    const { mutate: assignRoles, isPending: assigning } = useMutation({
        mutationFn: api.mutate(assignRolesToUserDocument),
        onSuccess: () => {
            toast.success(t`Role assigned`);
            closeAddRow();
            onChange();
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
            onChange();
        },
        onError: err => {
            toast.error(t`Failed to remove role`, {
                description: err instanceof Error ? err.message : undefined,
            });
        },
    });

    const roleLabel = (role: RoleAssignmentRow['role']) => role.description || role.code;
    const channelLabel = (code: string) => (code === DEFAULT_CHANNEL_CODE ? t`Default channel` : code);
    const groups = groupByRole(assignments);
    const showFilter = assignments.length > FILTER_THRESHOLD;
    const visibleGroups = filterGroups(groups, showFilter ? filter : '', roleLabel, channelLabel);

    const removePairs = (roleId: string, channelIds: string[]) =>
        removeRoles({
            input: { userId, assignments: channelIds.map(channelId => ({ roleId, channelId })) },
        });

    const toggleExpanded = (roleId: string) =>
        setExpandedRoleIds(current => {
            const next = new Set(current);
            if (next.has(roleId)) {
                next.delete(roleId);
            } else {
                next.add(roleId);
            }
            return next;
        });

    return (
        <div className="flex flex-col gap-4">
            {showFilter && (
                <Input
                    value={filter}
                    onChange={event => setFilter(event.target.value)}
                    placeholder={t`Filter...`}
                    aria-label={t`Filter role assignments`}
                    className="max-w-sm"
                />
            )}
            <Table>
                <TableHeader>
                    <TableRow>
                        <TableHead className="w-1/3">
                            <Trans>Role</Trans>
                        </TableHead>
                        <TableHead>
                            <Trans>Channels</Trans>
                        </TableHead>
                        {canEdit && <TableHead className="w-12" />}
                    </TableRow>
                </TableHeader>
                <TableBody>
                    {visibleGroups.length === 0 && (
                        <TableRow>
                            <TableCell colSpan={canEdit ? 3 : 2} className="text-muted-foreground">
                                {groups.length === 0 ? (
                                    <Trans>No roles assigned</Trans>
                                ) : (
                                    <Trans>No matches</Trans>
                                )}
                            </TableCell>
                        </TableRow>
                    )}
                    {visibleGroups.map(group => {
                        const superAdmin = isSuperAdminRole(group.role);
                        // The filter narrows the chips shown, never what the row's button
                        // removes or the count it reports: those cover every Channel of the Role.
                        const fullGroup = groups.find(g => g.roleId === group.roleId) ?? group;
                        const shownCount = group.channels.length;
                        const totalCount = fullGroup.channels.length;
                        const expanded = expandedRoleIds.has(group.roleId) || filter.trim() !== '';
                        const shownChannels = expanded
                            ? group.channels
                            : group.channels.slice(0, VISIBLE_CHANNELS);
                        const hiddenCount = group.channels.length - shownChannels.length;
                        return (
                            <TableRow key={group.roleId} data-testid="role-assignment-row">
                                <TableCell className="align-top">
                                    <div className="font-medium">{roleLabel(group.role)}</div>
                                    {!superAdmin && (
                                        <div className="text-xs text-muted-foreground">
                                            {shownCount < totalCount ? (
                                                <Trans>
                                                    {shownCount} of {totalCount} channels
                                                </Trans>
                                            ) : totalCount === 1 ? (
                                                <Trans>1 channel</Trans>
                                            ) : (
                                                <Trans>{totalCount} channels</Trans>
                                            )}
                                        </div>
                                    )}
                                </TableCell>
                                <TableCell>
                                    {superAdmin ? (
                                        <span className="text-muted-foreground">
                                            <Trans>All channels</Trans>
                                        </span>
                                    ) : (
                                        <div className="flex flex-wrap items-center gap-1.5">
                                            {shownChannels.map(channel => (
                                                <Chip
                                                    key={channel.channelId}
                                                    variant="default"
                                                    className="text-xs"
                                                    onRemove={
                                                        canEdit
                                                            ? () =>
                                                                  removePairs(group.roleId, [
                                                                      channel.channelId,
                                                                  ])
                                                            : undefined
                                                    }
                                                    removeLabel={
                                                        canEdit
                                                            ? t`Remove ${roleLabel(group.role)} on ${channelLabel(channel.code)}`
                                                            : undefined
                                                    }
                                                    disabled={removing}
                                                >
                                                    {onChannelSelect ? (
                                                        <button
                                                            type="button"
                                                            className="hover:underline"
                                                            title={t`Show permissions`}
                                                            onClick={() => onChannelSelect(channel.channelId)}
                                                        >
                                                            <ChannelCodeLabel code={channel.code} />
                                                        </button>
                                                    ) : (
                                                        <ChannelCodeLabel code={channel.code} />
                                                    )}
                                                </Chip>
                                            ))}
                                            {(hiddenCount > 0 ||
                                                (expandedRoleIds.has(group.roleId) &&
                                                    group.channels.length > VISIBLE_CHANNELS &&
                                                    filter.trim() === '')) && (
                                                <Button
                                                    type="button"
                                                    variant="link"
                                                    size="sm"
                                                    className="h-auto px-1"
                                                    onClick={() => toggleExpanded(group.roleId)}
                                                >
                                                    {hiddenCount > 0 ? (
                                                        <Trans>+{hiddenCount} more</Trans>
                                                    ) : (
                                                        <Trans>Show fewer</Trans>
                                                    )}
                                                </Button>
                                            )}
                                        </div>
                                    )}
                                </TableCell>
                                {canEdit && (
                                    <TableCell className="align-top">
                                        <RemoveRoleButton
                                            group={fullGroup}
                                            disabled={removing}
                                            onRemove={g =>
                                                removePairs(
                                                    g.roleId,
                                                    g.channels.map(c => c.channelId),
                                                )
                                            }
                                            onConfirmRemove={setRoleToRemove}
                                        />
                                    </TableCell>
                                )}
                            </TableRow>
                        );
                    })}
                </TableBody>
            </Table>
            {canEdit && !adding && (
                <div>
                    <Button type="button" variant="outline" size="sm" onClick={() => setAdding(true)}>
                        <Plus className="h-4 w-4" />
                        <Trans>Add role</Trans>
                    </Button>
                </div>
            )}
            {canEdit && adding && (
                <div className="flex items-start gap-2">
                    <div className="flex-1">
                        <RoleSelector
                            multiple={false}
                            value={newRoleId}
                            onChange={setNewRoleId}
                            excludeIds={[
                                ...nonGrantableRoleIds(newChannelIds),
                                ...(apiKeyChannelIds
                                    ? roles.filter(role => isSuperAdminRole(role)).map(role => role.id)
                                    : []),
                            ]}
                        />
                    </div>
                    <div className="flex-[2]">
                        {newRoleIsSuperAdmin ? (
                            <div className="flex h-9 items-center text-sm text-muted-foreground">
                                <Trans>All channels</Trans>
                            </div>
                        ) : (
                            <ChannelSelector
                                multiple={true}
                                value={newChannelIds}
                                onChange={setPickedChannelIds}
                                includeIds={grantableChannelIds(newRoleId || undefined).filter(
                                    id => !apiKeyChannelIds || apiKeyChannelIds.includes(id),
                                )}
                                ownChannelsOnly
                                showSelectAll
                            />
                        )}
                    </div>
                    <Button
                        type="button"
                        variant="outline"
                        disabled={!newRoleId || newAssignments.length === 0 || assigning}
                        onClick={() => assignRoles({ input: { userId, assignments: newAssignments } })}
                    >
                        <Plus className="h-4 w-4" />
                        <Trans>Assign role</Trans>
                    </Button>
                    <Button type="button" variant="ghost" onClick={closeAddRow}>
                        <Trans>Cancel</Trans>
                    </Button>
                </div>
            )}
            {roleToRemove && (
                <ConfirmDialog
                    open={!!roleToRemove}
                    onOpenChange={open => !open && setRoleToRemove(undefined)}
                    title={t`Remove from all channels`}
                    confirmLabel={t`Remove`}
                    cancelLabel={t`Cancel`}
                    variant="destructive"
                    description={t`Remove ${roleLabel(roleToRemove.role)} from ${roleToRemove.channels.length} channels?`}
                    onConfirm={() => {
                        removePairs(
                            roleToRemove.roleId,
                            roleToRemove.channels.map(c => c.channelId),
                        );
                        setRoleToRemove(undefined);
                    }}
                />
            )}
        </div>
    );
}

/**
 * Groups the pairs by Role, keeping the order in which each Role first appears.
 */
function groupByRole(assignments: RoleAssignmentRow[]): RoleGroup[] {
    const groups = new Map<string, RoleGroup>();
    for (const assignment of assignments) {
        let group = groups.get(assignment.roleId);
        if (!group) {
            group = { roleId: assignment.roleId, role: assignment.role, channels: [] };
            groups.set(assignment.roleId, group);
        }
        group.channels.push({ channelId: assignment.channelId, code: assignment.channel.code });
    }
    return Array.from(groups.values());
}

/**
 * Keeps the Roles whose name matches the filter with all their Channels, and of the other
 * Roles only the Channels whose name matches.
 */
function filterGroups(
    groups: RoleGroup[],
    filter: string,
    roleLabel: (role: RoleGroup['role']) => string,
    channelLabel: (code: string) => string,
): RoleGroup[] {
    const term = filter.trim().toLowerCase();
    if (!term) {
        return groups;
    }
    return groups.flatMap(group => {
        if (roleLabel(group.role).toLowerCase().includes(term)) {
            return [group];
        }
        const channels = group.channels.filter(channel =>
            channelLabel(channel.code).toLowerCase().includes(term),
        );
        return channels.length > 0 ? [{ ...group, channels }] : [];
    });
}

/**
 * The trash button of a Role row. A Role held on a single Channel (or SuperAdmin, which is one
 * row standing for every Channel) is removed directly, like a chip. A Role held on several
 * Channels asks for confirmation first, since one click revokes it everywhere.
 */
function RemoveRoleButton({
    group,
    disabled,
    onRemove,
    onConfirmRemove,
}: Readonly<{
    group: RoleGroup;
    disabled: boolean;
    onRemove: (group: RoleGroup) => void;
    onConfirmRemove: (group: RoleGroup) => void;
}>) {
    const { t } = useLingui();
    const single = isSuperAdminRole(group.role) || group.channels.length === 1;
    const label = single ? t`Remove role` : t`Remove from all channels`;
    return (
        <Button
            type="button"
            variant="ghost"
            size="icon"
            aria-label={label}
            title={label}
            disabled={disabled}
            onClick={() => (single ? onRemove(group) : onConfirmRemove(group))}
        >
            <Trash2 className="h-4 w-4" />
        </Button>
    );
}
