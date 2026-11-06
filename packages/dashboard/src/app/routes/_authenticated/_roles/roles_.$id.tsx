import { ChannelCodeLabel } from '@/vdb/components/shared/channel-code-label.js';
import { ErrorPage } from '@/vdb/components/shared/error-page.js';
import { FormFieldWrapper } from '@/vdb/components/shared/form-field-wrapper.js';
import { Button } from '@/vdb/components/ui/button.js';
import { Input } from '@/vdb/components/ui/input.js';
import { DEFAULT_CHANNEL_CODE, NEW_ENTITY_PATH } from '@/vdb/constants.js';
import { ActionBarItem } from '@/vdb/framework/layout-engine/action-bar-item-wrapper.js';
import {
    CustomFieldsPageBlock,
    DetailFormGrid,
    Page,
    PageActionBar,
    PageBlock,
    PageLayout,
    PageTitle,
} from '@/vdb/framework/layout-engine/page-layout.js';
import { detailPageRouteLoader } from '@/vdb/framework/page/detail-page-route-loader.js';
import { useDetailPage } from '@/vdb/framework/page/use-detail-page.js';
import { useChannel } from '@/vdb/hooks/use-channel.js';
import { Trans, useLingui } from '@lingui/react/macro';
import { createFileRoute, useNavigate } from '@tanstack/react-router';
import { toast } from 'sonner';
import { PermissionsTableGrid } from './components/permissions-table-grid.js';
import { createRoleDocument, roleDetailDocument, updateRoleDocument } from './roles.graphql.js';

const pageId = 'role-detail';

export const Route = createFileRoute('/_authenticated/_roles/roles_/$id')({
    component: RoleDetailPage,
    loader: detailPageRouteLoader({
        pageId,
        queryDocument: roleDetailDocument,
        breadcrumb(isNew, entity) {
            return [
                { path: '/roles', label: <Trans>Roles</Trans> },
                isNew ? <Trans>New role</Trans> : entity?.description,
            ];
        },
    }),
    errorComponent: ({ error }) => <ErrorPage error={error} />,
});

function RoleDetailPage() {
    const params = Route.useParams();
    const navigate = useNavigate();
    const creatingNewEntity = params.id === NEW_ENTITY_PATH;
    const { t } = useLingui();
    const { activeChannel } = useChannel();

    const { form, submitHandler, entity, isPending, resetForm } = useDetailPage({
        pageId,
        queryDocument: roleDetailDocument,
        createDocument: createRoleDocument,
        updateDocument: updateRoleDocument,
        setValuesForUpdate: entity => {
            return {
                id: entity.id,
                code: entity.code,
                description: entity.description,
                permissions: entity.permissions,
                customFields: entity.customFields,
            };
        },
        params: { id: params.id },
        onSuccess: async data => {
            toast.success(creatingNewEntity ? t`Successfully created role` : t`Successfully updated role`);
            resetForm();
            if (creatingNewEntity) {
                await navigate({ to: `../$id`, params: { id: data.id } });
            }
        },
        onError: err => {
            toast.error(creatingNewEntity ? t`Failed to create role` : t`Failed to update role`, {
                description: err instanceof Error ? err.message : 'Unknown error',
            });
        },
    });

    // A new Role is owned by the active channel; an existing one keeps its owner
    const ownerChannel = creatingNewEntity ? activeChannel : entity?.channel;
    const isShared = ownerChannel?.code === DEFAULT_CHANNEL_CODE;

    return (
        <Page pageId={pageId} form={form} submitHandler={submitHandler} entity={entity}>
            <PageTitle>{creatingNewEntity ? <Trans>New role</Trans> : (entity?.description ?? '')}</PageTitle>
            <PageActionBar>
                <ActionBarItem
                    itemId="save-button"
                    requiresPermission={creatingNewEntity ? ['CreateRole'] : ['UpdateRole']}
                >
                    <Button
                        type="submit"
                        disabled={!form.formState.isDirty || !form.formState.isValid || isPending}
                    >
                        {creatingNewEntity ? <Trans>Create</Trans> : <Trans>Update</Trans>}
                    </Button>
                </ActionBarItem>
            </PageActionBar>
            <PageLayout>
                <PageBlock column="main" blockId="main-form">
                    <DetailFormGrid>
                        <FormFieldWrapper
                            control={form.control}
                            name="description"
                            label={<Trans>Description</Trans>}
                            render={({ field }) => <Input {...field} />}
                        />
                        <FormFieldWrapper
                            control={form.control}
                            name="code"
                            label={<Trans>Code</Trans>}
                            render={({ field }) => <Input {...field} />}
                        />
                    </DetailFormGrid>
                    {ownerChannel && (
                        <p className="text-sm text-muted-foreground mt-4" data-testid="role-owner-note">
                            {isShared ? (
                                creatingNewEntity ? (
                                    <Trans>
                                        This role will be shared: it is created on the default channel, so it
                                        can be assigned on every channel.
                                    </Trans>
                                ) : (
                                    <Trans>
                                        This is a shared role, owned by the default channel. It can be
                                        assigned on every channel.
                                    </Trans>
                                )
                            ) : creatingNewEntity ? (
                                <Trans>
                                    This role will be owned by the channel{' '}
                                    <ChannelCodeLabel code={ownerChannel.code} /> and can only be assigned
                                    there. Create it on the default channel to share it across channels.
                                </Trans>
                            ) : (
                                <Trans>
                                    This role is owned by the channel{' '}
                                    <ChannelCodeLabel code={ownerChannel.code} /> and can only be assigned
                                    there.
                                </Trans>
                            )}
                        </p>
                    )}
                </PageBlock>
                <CustomFieldsPageBlock column="main" entityType="Role" control={form.control} />
                <PageBlock column="main" blockId="permissions">
                    <FormFieldWrapper
                        control={form.control}
                        name="permissions"
                        label={<Trans>Permissions</Trans>}
                        render={({ field }) => (
                            <PermissionsTableGrid
                                value={field.value ?? []}
                                onChange={value => field.onChange(value)}
                            />
                        )}
                    />
                </PageBlock>
            </PageLayout>
        </Page>
    );
}
