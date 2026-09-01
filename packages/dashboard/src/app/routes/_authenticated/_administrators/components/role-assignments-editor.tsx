import { ChannelCodeLabel } from '@/vdb/components/shared/channel-code-label.js';
import { ChannelSelector } from '@/vdb/components/shared/channel-selector.js';
import { RoleSelector } from '@/vdb/components/shared/role-selector.js';
import { Badge } from '@/vdb/components/ui/badge.js';
import { Button } from '@/vdb/components/ui/button.js';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/vdb/components/ui/tooltip.js';
import { useChannel } from '@/vdb/hooks/use-channel.js';
import { useGrantableRoles } from '@/vdb/hooks/use-grantable-roles.js';
import { useRoles } from '@/vdb/hooks/use-roles.js';
import { Trans, useLingui } from '@lingui/react/macro';
import { Lock, Plus, Trash2 } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';

/**
 * One (Role, Channel) grant in the form value. Pairs loaded from the server carry the Role
 * and Channel identities from the assignment row itself; pairs added in the editor do not
 * (their ids resolve through the selectors by construction). The identities are what label
 * locked rows: a channel-scoped actor cannot resolve those ids any other way — the channels
 * query is FORBIDDEN and gate-hidden Roles are absent from the roles query.
 * `completeRoleAssignmentPairs` strips them before the replace-set input.
 */
export interface RoleAssignmentPair {
    roleId: string;
    channelId: string;
    role?: { code: string; description?: string | null } | null;
    channel?: { code: string } | null;
}

interface EditorRow {
    key: number;
    roleId: string;
    channelIds: string[];
}

export interface RoleAssignmentsEditorProps {
    value: RoleAssignmentPair[];
    onChange: (value: RoleAssignmentPair[]) => void;
    /**
     * Offer only the Roles and Channels the active user may actually grant. The server
     * enforces this on save regardless; restricting the inputs keeps a combination that
     * cannot be saved from being picked in the first place. Assignments the active user
     * cannot grant render locked: visible, preserved on save, not editable.
     */
    restrictToGrantable?: boolean;
}

let nextRowKey = 0;

/**
 * Normalizes form-value pairs into the shape the `roleAssignments` replace-set input takes.
 * The generated form seeds a list-of-input-object field with one blank item, so incomplete
 * pairs arrive here on the create page and must not be treated as assignments; server-loaded
 * pairs carry the embedded Role/Channel identities, which the input does not accept.
 */
export function completeRoleAssignmentPairs(
    pairs: RoleAssignmentPair[] | null | undefined,
): RoleAssignmentPair[] {
    return (pairs ?? [])
        .filter(pair => !!pair?.roleId && !!pair?.channelId)
        .map(({ roleId, channelId }) => ({ roleId, channelId }));
}

/**
 * Harvests Role and Channel names from the identities embedded on server-loaded pairs. The
 * maps are grow-only across renders: the editor emits bare pairs, so labels seen on the
 * initial form value must survive later value changes (an id's identity never changes, so
 * stale entries cannot exist).
 */
export function useRoleAssignmentLabels(pairs: RoleAssignmentPair[] | null | undefined) {
    const labels = useRef({
        roles: new Map<string, string>(),
        channels: new Map<string, string>(),
    });
    // Written during render: idempotent grow-only writes, safe to repeat.
    for (const pair of pairs ?? []) {
        if (pair?.role) {
            labels.current.roles.set(pair.roleId, pair.role.description || pair.role.code);
        }
        if (pair?.channel) {
            labels.current.channels.set(pair.channelId, pair.channel.code);
        }
    }
    return labels.current;
}

function groupPairsIntoRows(pairs: RoleAssignmentPair[]): EditorRow[] {
    const rows: EditorRow[] = [];
    const rowByRoleId = new Map<string, EditorRow>();
    for (const pair of pairs) {
        let row = rowByRoleId.get(pair.roleId);
        if (!row) {
            row = { key: nextRowKey++, roleId: pair.roleId, channelIds: [] };
            rowByRoleId.set(pair.roleId, row);
            rows.push(row);
        }
        if (!row.channelIds.includes(pair.channelId)) {
            row.channelIds.push(pair.channelId);
        }
    }
    return rows;
}

function flattenRowsIntoPairs(rows: EditorRow[]): RoleAssignmentPair[] {
    const pairs: RoleAssignmentPair[] = [];
    const seen = new Set<string>();
    for (const row of rows) {
        if (!row.roleId) {
            continue;
        }
        for (const channelId of row.channelIds) {
            if (!channelId) {
                continue;
            }
            const pairKey = `${row.roleId}|${channelId}`;
            if (!seen.has(pairKey)) {
                seen.add(pairKey);
                pairs.push({ roleId: row.roleId, channelId });
            }
        }
    }
    return pairs;
}

function pairsAreEqual(a: RoleAssignmentPair[], b: RoleAssignmentPair[]): boolean {
    if (a.length !== b.length) {
        return false;
    }
    const keys = new Set(a.map(pair => `${pair.roleId}|${pair.channelId}`));
    return b.every(pair => keys.has(`${pair.roleId}|${pair.channelId}`));
}

/**
 * Edits a User's role assignments as one row per Role, listing the Channels that Role is
 * granted on. The form value is the flat list of (roleId, channelId) pairs taken by the
 * `roleAssignments` input, which replaces the User's assignments across all Channels.
 *
 * Under `restrictToGrantable`, pairs the active user cannot grant (mirroring the server-side
 * `assertActiveUserCanGrantRoles`: they lack the Role's full permission envelope on that
 * Channel) render locked. Locked Channels show as badges, the Role selector becomes a static
 * label (changing the Role would drop the locked pair) and the row cannot be removed. The
 * locked pairs stay in the emitted value, so the replace-set input carries them verbatim and
 * the server passes them through untouched.
 */
export function RoleAssignmentsEditor({
    value,
    onChange,
    restrictToGrantable,
}: Readonly<RoleAssignmentsEditorProps>) {
    const { activeChannel } = useChannel();
    const { t } = useLingui();
    const { roles } = useRoles();
    const { isRoleGrantableOnChannel, nonGrantableRoleIds, grantableChannelIds } = useGrantableRoles();
    const assignmentLabels = useRoleAssignmentLabels(value);
    const [rows, setRows] = useState<EditorRow[]>(() =>
        groupPairsIntoRows(completeRoleAssignmentPairs(value)),
    );
    // A row with no Role, or a Role with no Channels, produces no pairs, so it exists only
    // in the UI. External value changes (form reset, refetch) are therefore detected by
    // comparing against the pairs last emitted rather than mirrored on every render.
    const lastEmitted = useRef<RoleAssignmentPair[]>(completeRoleAssignmentPairs(value));
    const seededEmptyRow = useRef(false);

    useEffect(() => {
        const incoming = completeRoleAssignmentPairs(value);
        if (!pairsAreEqual(incoming, lastEmitted.current)) {
            lastEmitted.current = incoming;
            setRows(groupPairsIntoRows(incoming));
        }
    }, [value]);

    // Start a User with no assignments off with a row on the active channel, so the common
    // single-channel case is just "pick a role".
    useEffect(() => {
        if (seededEmptyRow.current) {
            return;
        }
        if (completeRoleAssignmentPairs(value).length > 0) {
            seededEmptyRow.current = true;
            return;
        }
        if (activeChannel) {
            seededEmptyRow.current = true;
            setRows(current =>
                current.length === 0
                    ? [{ key: nextRowKey++, roleId: '', channelIds: [activeChannel.id] }]
                    : current,
            );
        }
    }, [value, activeChannel]);

    const emit = (nextRows: EditorRow[]) => {
        setRows(nextRows);
        const pairs = flattenRowsIntoPairs(nextRows);
        lastEmitted.current = pairs;
        onChange(pairs);
    };

    const addRow = () => {
        emit([
            ...rows,
            { key: nextRowKey++, roleId: '', channelIds: activeChannel ? [activeChannel.id] : [] },
        ]);
    };

    const roleLabelFor = (roleId: string) => {
        const role = roles.find(r => r.id === roleId);
        return (role && (role.description || role.code)) || assignmentLabels.roles.get(roleId) || roleId;
    };
    const channelLabelFor = (channelId: string) => assignmentLabels.channels.get(channelId) ?? channelId;

    /**
     * The Channels of this row the active user cannot grant the Role on. These render as
     * locked badges and are re-merged into every channel change, so no interaction can drop
     * them: the replace-set input must carry them verbatim for the server-side grant guard
     * to pass them through as untouched. A gate-hidden Role is absent from `roles`, which
     * makes every one of its Channels non-grantable — fail-closed while data loads too.
     */
    const lockedChannelIdsOf = (row: EditorRow) =>
        restrictToGrantable && row.roleId
            ? row.channelIds.filter(channelId => !isRoleGrantableOnChannel(row.roleId, channelId))
            : [];

    return (
        <TooltipProvider>
            <div className="flex flex-col gap-2">
                {rows.length > 0 && (
                    <div className="flex gap-2 text-sm font-medium text-muted-foreground">
                        <div className="flex-1">
                            <Trans>Role</Trans>
                        </div>
                        <div className="flex-[2]">
                            <Trans>Channels</Trans>
                        </div>
                        <div className="w-9" />
                    </div>
                )}
                {rows.map(row => {
                    const lockedChannelIds = lockedChannelIdsOf(row);
                    const editableChannelIds = row.channelIds.filter(
                        channelId => !lockedChannelIds.includes(channelId),
                    );
                    const hasLockedChannels = lockedChannelIds.length > 0;
                    const offerableChannelIds = restrictToGrantable
                        ? grantableChannelIds(row.roleId)
                        : undefined;
                    // A fully locked row with nothing offerable (typically a gate-hidden Role)
                    // is pure display; an empty selector would suggest editability that isn't
                    // there.
                    const showChannelSelector =
                        !hasLockedChannels ||
                        editableChannelIds.length > 0 ||
                        (offerableChannelIds?.length ?? 1) > 0;
                    return (
                        <div key={row.key} className="flex items-start gap-2">
                            <div className="flex-1">
                                {hasLockedChannels ? (
                                    <div className="flex h-9 items-center gap-2 rounded-md border bg-muted/50 px-3 text-sm">
                                        <Lock
                                            className="h-3.5 w-3.5 shrink-0 text-muted-foreground"
                                            aria-label={t`Locked role`}
                                        />
                                        <span className="truncate">{roleLabelFor(row.roleId)}</span>
                                    </div>
                                ) : (
                                    <RoleSelector
                                        multiple={false}
                                        value={row.roleId}
                                        onChange={roleId =>
                                            emit(rows.map(r => (r === row ? { ...r, roleId } : r)))
                                        }
                                        excludeIds={[
                                            ...rows.filter(r => r !== row && r.roleId).map(r => r.roleId),
                                            ...(restrictToGrantable
                                                ? nonGrantableRoleIds(row.channelIds)
                                                : []),
                                        ]}
                                    />
                                )}
                            </div>
                            <div className="flex flex-[2] flex-col gap-1">
                                {hasLockedChannels && (
                                    <div className="flex min-h-9 flex-wrap items-center gap-1">
                                        {lockedChannelIds.map(channelId => (
                                            <Tooltip key={channelId}>
                                                <TooltipTrigger render={<span className="cursor-default" />}>
                                                    <Badge variant="secondary" className="gap-1">
                                                        <Lock className="h-3 w-3" />
                                                        <ChannelCodeLabel code={channelLabelFor(channelId)} />
                                                    </Badge>
                                                </TooltipTrigger>
                                                <TooltipContent side="top" className="max-w-[250px]">
                                                    <Trans>
                                                        You cannot change this assignment: you do not hold all
                                                        of this role's permissions on this channel.
                                                    </Trans>
                                                </TooltipContent>
                                            </Tooltip>
                                        ))}
                                    </div>
                                )}
                                {showChannelSelector && (
                                    <ChannelSelector
                                        multiple={true}
                                        value={editableChannelIds}
                                        onChange={channelIds =>
                                            emit(
                                                rows.map(r =>
                                                    r === row
                                                        ? {
                                                              ...r,
                                                              channelIds: [
                                                                  ...lockedChannelIds,
                                                                  ...channelIds,
                                                              ],
                                                          }
                                                        : r,
                                                ),
                                            )
                                        }
                                        includeIds={offerableChannelIds}
                                        ownChannelsOnly={restrictToGrantable}
                                    />
                                )}
                            </div>
                            {hasLockedChannels ? (
                                <div className="h-9 w-9" aria-hidden="true" />
                            ) : (
                                <Button
                                    type="button"
                                    variant="ghost"
                                    size="icon"
                                    aria-label={t`Remove role`}
                                    onClick={() => emit(rows.filter(r => r !== row))}
                                >
                                    <Trash2 className="h-4 w-4" />
                                </Button>
                            )}
                        </div>
                    );
                })}
                {rows.length === 0 && (
                    <div className="text-sm text-muted-foreground">
                        <Trans>No roles assigned</Trans>
                    </div>
                )}
                <div>
                    <Button type="button" variant="outline" size="sm" onClick={addRow}>
                        <Plus className="h-4 w-4" />
                        <Trans>Add role</Trans>
                    </Button>
                </div>
            </div>
        </TooltipProvider>
    );
}
