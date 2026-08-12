import { ChannelSelector } from '@/vdb/components/shared/channel-selector.js';
import { RoleSelector } from '@/vdb/components/shared/role-selector.js';
import { Button } from '@/vdb/components/ui/button.js';
import { Trans } from '@lingui/react/macro';
import { Plus, Trash2 } from 'lucide-react';

export interface ChannelRoleValue {
    roleId: string;
    channelIds: string[];
}

export interface ChannelRoleMatrixProps {
    value: ChannelRoleValue[];
    onChange: (value: ChannelRoleValue[]) => void;
}

/**
 * Lets a Role be granted to an Administrator on specific Channels only, so that a single Role can be
 * shared between Channels without every holder of it gaining access to all of them.
 *
 * Rendered in place of the plain role list when `authOptions.channelScopedRoles` is enabled.
 */
export function ChannelRoleMatrix({ value, onChange }: ChannelRoleMatrixProps) {
    function updateRow(index: number, patch: Partial<ChannelRoleValue>) {
        onChange(value.map((row, i) => (i === index ? { ...row, ...patch } : row)));
    }

    function removeRow(index: number) {
        onChange(value.filter((_, i) => i !== index));
    }

    function addRow() {
        onChange([...value, { roleId: '', channelIds: [] }]);
    }

    // A Role may only appear once, since its channels are all listed on the same row.
    const usedRoleIds = new Set(value.map(row => row.roleId).filter(Boolean));

    return (
        <div className="space-y-4">
            {value.length === 0 && (
                <div className="text-sm text-muted-foreground">
                    <Trans>No channel-specific roles assigned.</Trans>
                </div>
            )}
            {value.map((row, index) => (
                <div key={index} className="flex flex-col md:flex-row gap-2 md:items-start">
                    <div className="md:w-1/3">
                        <div className="text-sm font-medium mb-1">
                            <Trans>Role</Trans>
                        </div>
                        <RoleSelector
                            value={row.roleId}
                            onChange={roleId => updateRow(index, { roleId })}
                            multiple={false}
                        />
                    </div>
                    <div className="flex-1">
                        <div className="text-sm font-medium mb-1">
                            <Trans>Channels</Trans>
                        </div>
                        <ChannelSelector
                            value={row.channelIds}
                            onChange={channelIds => updateRow(index, { channelIds })}
                            multiple={true}
                        />
                    </div>
                    <Button
                        type="button"
                        variant="ghost"
                        size="icon"
                        className="md:mt-6"
                        onClick={() => removeRow(index)}
                    >
                        <Trash2 />
                    </Button>
                </div>
            ))}
            <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={addRow}
                disabled={value.some(row => !row.roleId || row.channelIds.length === 0)}
            >
                <Plus />
                <Trans>Add channel role</Trans>
            </Button>
            {usedRoleIds.size !== value.filter(row => row.roleId).length && (
                <div className="text-sm text-destructive">
                    <Trans>Each role may only be listed once.</Trans>
                </div>
            )}
        </div>
    );
}
