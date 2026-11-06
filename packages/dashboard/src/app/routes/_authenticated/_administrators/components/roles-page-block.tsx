import { FormFieldWrapper } from '@/vdb/components/shared/form-field-wrapper.js';
import { PageBlock } from '@/vdb/framework/layout-engine/page-layout.js';
import { Trans } from '@lingui/react/macro';
import { UseFormReturn } from 'react-hook-form';

import { EffectivePermissionsPanel } from './effective-permissions-panel.js';
import { RoleAssignmentPair, RoleAssignmentsEditor } from './role-assignments-editor.js';
import { RoleAssignmentRow, RoleAssignmentsTable } from './role-assignments-table.js';

export interface RolesPageBlockProps {
    column: 'main' | 'side';
    /**
     * Whose roles the block shows, which only changes the wording.
     */
    subject: 'administrator' | 'apiKey';
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
    subject,
    createForm,
    user,
    onChange,
    apiKeyChannelIds,
}: Readonly<RolesPageBlockProps>) {
    const formAssignments = createForm?.watch('roleAssignments');
    const description =
        subject === 'administrator' ? (
            <Trans>
                What this administrator can do on the selected channel, derived from the roles assigned above.
                Edit the roles to change it.
            </Trans>
        ) : (
            <Trans>
                What this API key can do on the selected channel, derived from the roles assigned above. Edit
                the roles to change it.
            </Trans>
        );

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
                    <Trans>
                        You can only grant a role on a channel where you hold all of that role's permissions
                        yourself.
                    </Trans>
                </p>
                <EffectivePermissionsPanel assignments={formAssignments ?? []} description={description} />
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
            />
            <p className="text-xs text-muted-foreground mt-2">
                <Trans>
                    Changes to roles are saved immediately. You can only see and change assignments of roles
                    whose permissions you hold yourself on that channel.
                </Trans>
            </p>
            <EffectivePermissionsPanel assignments={user.roleAssignments} description={description} />
        </PageBlock>
    );
}
