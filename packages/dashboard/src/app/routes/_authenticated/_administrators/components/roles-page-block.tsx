import { FormFieldWrapper } from '@/vdb/components/shared/form-field-wrapper.js';
import { PageBlock } from '@/vdb/framework/layout-engine/page-layout.js';
import { Trans } from '@lingui/react/macro';
import { useRef, useState } from 'react';
import { UseFormReturn } from 'react-hook-form';

import { EffectivePermissionsPanel } from './effective-permissions-panel.js';
import { RoleAssignmentPair, RoleAssignmentsEditor } from './role-assignments-editor.js';
import { RoleAssignmentRow, RoleAssignmentsTable } from './role-assignments-table.js';

export interface RolesPageBlockProps {
    column: 'main' | 'side';
    /**
     * Set on creation: the form whose `roleAssignments` field collects the grants, which are
     * sent with the create mutation.
     */
    createForm?: UseFormReturn<{ roleAssignments: RoleAssignmentPair[] }>;
    /**
     * Set once the User exists: its assignments, which are edited through their own mutations.
     */
    user?: { id: string; roleAssignments: RoleAssignmentRow[] };
    /**
     * Called after an assignment of an existing User was added or removed.
     */
    onChange: () => void;
    /**
     * Set for an API key: the Channels the key belongs to. See {@link RoleAssignmentsTable}.
     */
    apiKeyChannelIds?: string[];
}

/**
 * The Roles block of the Administrator and API key detail pages. On creation it edits the
 * grants as part of the form; once the User exists it lists them and saves each change
 * immediately.
 */
export function RolesPageBlock({
    column,
    createForm,
    user,
    onChange,
    apiKeyChannelIds,
}: Readonly<RolesPageBlockProps>) {
    const formAssignments = createForm?.watch('roleAssignments');
    const [permissionsChannelId, setPermissionsChannelId] = useState<string | undefined>();
    const permissionsRef = useRef<HTMLDivElement>(null);
    // A Channel clicked in the assignments table: show what the User can do there.
    const showPermissionsOn = (channelId: string) => {
        setPermissionsChannelId(channelId);
        permissionsRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    };
    if (createForm) {
        return (
            <PageBlock column={column} blockId="roles" title={<Trans>Roles</Trans>}>
                <FormFieldWrapper
                    control={createForm.control}
                    name="roleAssignments"
                    render={({ field }) => (
                        <RoleAssignmentsEditor
                            value={field.value ?? []}
                            onChange={field.onChange}
                            apiKeyChannelIds={apiKeyChannelIds}
                        />
                    )}
                />
                <p className="text-xs text-muted-foreground mt-2">
                    <Trans>Only roles you hold are shown.</Trans>
                </p>
                <EffectivePermissionsPanel assignments={formAssignments ?? []} />
            </PageBlock>
        );
    }
    if (!user) {
        return null;
    }
    return (
        <PageBlock column={column} blockId="roles" title={<Trans>Roles</Trans>}>
            <RoleAssignmentsTable
                userId={user.id}
                assignments={user.roleAssignments}
                apiKeyChannelIds={apiKeyChannelIds}
                onChange={onChange}
                onChannelSelect={showPermissionsOn}
            />
            <p className="text-xs text-muted-foreground mt-2">
                <Trans>Changes save immediately.</Trans>
            </p>
            <div ref={permissionsRef} className="scroll-mt-4">
                <EffectivePermissionsPanel
                    assignments={user.roleAssignments}
                    channelId={permissionsChannelId}
                    onChannelChange={setPermissionsChannelId}
                />
            </div>
        </PageBlock>
    );
}
