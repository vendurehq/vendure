import { ErrorPage } from '@/vdb/components/shared/error-page.js';
import { FormFieldWrapper } from '@/vdb/components/shared/form-field-wrapper.js';
import { RoleSelector } from '@/vdb/components/shared/role-selector.js';
import { Button } from '@/vdb/components/ui/button.js';
import { Input } from '@/vdb/components/ui/input.js';
import { PasswordInput } from '@/vdb/components/ui/password-input.js';
import { NEW_ENTITY_PATH } from '@/vdb/constants.js';
import { ActionBarItem } from '@/vdb/framework/layout-engine/action-bar-item-wrapper.js';
import {
    CustomFieldsPageBlock,
    Page,
    PageActionBar,
    PageBlock,
    PageLayout,
    PageTitle,
} from '@/vdb/framework/layout-engine/page-layout.js';
import { detailPageRouteLoader } from '@/vdb/framework/page/detail-page-route-loader.js';
import { useDetailPage } from '@/vdb/framework/page/use-detail-page.js';
import { useServerConfig } from '@/vdb/hooks/use-server-config.js';
import { Trans, useLingui } from '@lingui/react/macro';
import { createFileRoute, useNavigate } from '@tanstack/react-router';
import { toast } from 'sonner';
import {
    administratorDetailDocument,
    createAdministratorDocument,
    updateAdministratorDocument,
} from './administrators.graphql.js';
import { ChannelRoleMatrix } from './components/channel-role-matrix.js';
import { RolePermissionsDisplay } from './components/role-permissions-display.js';

const pageId = 'administrator-detail';

/**
 * The server rejects `channelRoles` unless `authOptions.channelScopedRoles` is enabled, so the field is
 * omitted entirely rather than sent as an empty array.
 */
function stripDisabledChannelRoles<T extends { channelRoles?: unknown }>(
    input: T,
    channelScopedRoles: boolean,
): T {
    if (channelScopedRoles) {
        return input;
    }
    const { channelRoles, ...rest } = input;
    return rest as T;
}

export const Route = createFileRoute('/_authenticated/_administrators/administrators_/$id')({
    component: AdministratorDetailPage,
    loader: detailPageRouteLoader({
        pageId,
        queryDocument: administratorDetailDocument,
        breadcrumb: (isNew, entity) => {
            const name = `${entity?.firstName} ${entity?.lastName}`;
            return [
                { path: '/administrators', label: <Trans>Administrators</Trans> },
                isNew ? <Trans>New administrator</Trans> : name,
            ];
        },
    }),
    errorComponent: ({ error }) => <ErrorPage error={error} />,
});

function AdministratorDetailPage() {
    const params = Route.useParams();
    const navigate = useNavigate();
    const creatingNewEntity = params.id === NEW_ENTITY_PATH;
    const { t } = useLingui();
    const channelScopedRoles = useServerConfig()?.channelScopedRoles === true;

    const { form, submitHandler, entity, isPending, resetForm } = useDetailPage({
        pageId,
        queryDocument: administratorDetailDocument,
        createDocument: createAdministratorDocument,
        updateDocument: updateAdministratorDocument,
        setValuesForUpdate: entity => {
            return {
                id: entity.id,
                firstName: entity.firstName,
                lastName: entity.lastName,
                emailAddress: entity.emailAddress,
                password: '',
                customFields: entity.customFields,
                roleIds: entity.user.roles.map(role => role.id),
                channelRoles: entity.channelRoles.map(channelRole => ({
                    roleId: channelRole.role.id,
                    channelIds: channelRole.channels.map(channel => channel.id),
                })),
            };
        },
        transformCreateInput: input => stripDisabledChannelRoles(input, channelScopedRoles),
        transformUpdateInput: input => {
            return stripDisabledChannelRoles(
                {
                    ...input,
                    password: input.password || undefined,
                },
                channelScopedRoles,
            );
        },
        params: { id: params.id },
        onSuccess: async data => {
            toast(
                creatingNewEntity
                    ? t`Successfully created administrator`
                    : t`Successfully updated administrator`,
            );
            resetForm();
            if (creatingNewEntity) {
                await navigate({ to: `../$id`, params: { id: data.id } });
            }
        },
        onError: err => {
            toast(creatingNewEntity ? t`Failed to create administrator` : t`Failed to update administrator`, {
                description: err instanceof Error ? err.message : 'Unknown error',
            });
        },
    });

    const name = `${entity?.firstName} ${entity?.lastName}`;
    const roleIds = form.watch('roleIds');

    return (
        <Page pageId={pageId} form={form} submitHandler={submitHandler} entity={entity}>
            <PageTitle>{creatingNewEntity ? <Trans>New administrator</Trans> : name}</PageTitle>

            <PageActionBar>
                <ActionBarItem itemId="save-button" requiresPermission={['UpdateAdministrator']}>
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
                    <div className="md:grid md:grid-cols-2 gap-4">
                        <FormFieldWrapper
                            control={form.control}
                            name="firstName"
                            label={<Trans>First name</Trans>}
                            render={({ field }) => <Input placeholder="" {...field} />}
                        />
                        <FormFieldWrapper
                            control={form.control}
                            name="lastName"
                            label={<Trans>Last name</Trans>}
                            render={({ field }) => <Input placeholder="" {...field} />}
                        />
                        <FormFieldWrapper
                            control={form.control}
                            name="emailAddress"
                            label={<Trans>Email Address or identifier</Trans>}
                            render={({ field }) => <Input placeholder="" {...field} />}
                        />
                        <FormFieldWrapper
                            control={form.control}
                            name="password"
                            label={<Trans>Password</Trans>}
                            render={({ field }) => <PasswordInput {...field} />}
                        />
                    </div>
                </PageBlock>
                <CustomFieldsPageBlock column="main" entityType="Administrator" control={form.control} />
                <PageBlock column="main" blockId="roles" title={<Trans>Roles</Trans>}>
                    <FormFieldWrapper
                        control={form.control}
                        name="roleIds"
                        label={channelScopedRoles ? <Trans>Global roles</Trans> : undefined}
                        description={
                            channelScopedRoles ? (
                                <Trans>
                                    These roles apply on every channel. Roles which cover only some channels
                                    must be assigned below.
                                </Trans>
                            ) : undefined
                        }
                        render={({ field }) => (
                            <RoleSelector
                                value={field.value ?? []}
                                onChange={field.onChange}
                                multiple={true}
                            />
                        )}
                    />
                    {!channelScopedRoles && <RolePermissionsDisplay value={roleIds ?? []} />}
                </PageBlock>
                {channelScopedRoles && (
                    <PageBlock column="main" blockId="channel-roles" title={<Trans>Channel roles</Trans>}>
                        <FormFieldWrapper
                            control={form.control}
                            name="channelRoles"
                            description={
                                <Trans>
                                    Grant a role on specific channels only. The same role can be shared
                                    between channels without granting access to all of them.
                                </Trans>
                            }
                            render={({ field }) => (
                                <ChannelRoleMatrix value={field.value ?? []} onChange={field.onChange} />
                            )}
                        />
                    </PageBlock>
                )}
            </PageLayout>
        </Page>
    );
}
