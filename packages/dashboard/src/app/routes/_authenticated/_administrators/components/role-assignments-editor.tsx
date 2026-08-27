import { ChannelSelector } from '@/vdb/components/shared/channel-selector.js';
import { RoleSelector } from '@/vdb/components/shared/role-selector.js';
import { Button } from '@/vdb/components/ui/button.js';
import { useChannel } from '@/vdb/hooks/use-channel.js';
import { Trans, useLingui } from '@lingui/react/macro';
import { Plus, Trash2 } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';

export interface RoleAssignmentPair {
    roleId: string;
    channelId: string;
}

interface EditorRow {
    key: number;
    roleId: string;
    channelIds: string[];
}

export interface RoleAssignmentsEditorProps {
    value: RoleAssignmentPair[];
    onChange: (value: RoleAssignmentPair[]) => void;
}

let nextRowKey = 0;

/**
 * The generated form seeds a list-of-input-object field with one blank item, so incomplete
 * pairs arrive here on the create page and must not be treated as assignments.
 */
function completePairs(pairs: RoleAssignmentPair[] | undefined): RoleAssignmentPair[] {
    return (pairs ?? []).filter(pair => !!pair?.roleId && !!pair?.channelId);
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
 */
export function RoleAssignmentsEditor({ value, onChange }: Readonly<RoleAssignmentsEditorProps>) {
    const { activeChannel } = useChannel();
    const { t } = useLingui();
    const [rows, setRows] = useState<EditorRow[]>(() => groupPairsIntoRows(completePairs(value)));
    // A row with no Role, or a Role with no Channels, produces no pairs, so it exists only
    // in the UI. External value changes (form reset, refetch) are therefore detected by
    // comparing against the pairs last emitted rather than mirrored on every render.
    const lastEmitted = useRef<RoleAssignmentPair[]>(completePairs(value));
    const seededEmptyRow = useRef(false);

    useEffect(() => {
        const incoming = completePairs(value);
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
        if (completePairs(value).length > 0) {
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

    return (
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
            {rows.map(row => (
                <div key={row.key} className="flex items-start gap-2">
                    <div className="flex-1">
                        <RoleSelector
                            multiple={false}
                            value={row.roleId}
                            onChange={roleId => emit(rows.map(r => (r === row ? { ...r, roleId } : r)))}
                            excludeIds={rows.filter(r => r !== row && r.roleId).map(r => r.roleId)}
                        />
                    </div>
                    <div className="flex-[2]">
                        <ChannelSelector
                            multiple={true}
                            value={row.channelIds}
                            onChange={channelIds =>
                                emit(rows.map(r => (r === row ? { ...r, channelIds } : r)))
                            }
                        />
                    </div>
                    <Button
                        type="button"
                        variant="ghost"
                        size="icon"
                        aria-label={t`Remove role`}
                        onClick={() => emit(rows.filter(r => r !== row))}
                    >
                        <Trash2 className="h-4 w-4" />
                    </Button>
                </div>
            ))}
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
    );
}
