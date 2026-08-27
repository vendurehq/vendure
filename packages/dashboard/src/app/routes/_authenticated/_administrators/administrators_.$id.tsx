import { ErrorPage } from '@/vdb/components/shared/error-page.js';
import { FormFieldWrapper } from '@/vdb/components/shared/form-field-wrapper.js';
import { Button } from '@/vdb/components/ui/button.js';
import { Input } from '@/vdb/components/ui/input.js';
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
import { Trans, useLingui } from '@lingui/react/macro';
import { createFileRoute, useNavigate } from '@tanstack/react-router';
import { toast } from 'sonner';
import {
    administratorDetailDocument,
    createAdministratorDocument,
    updateAdministratorDocument,
} from './administrators.graphql.js';
import { EffectivePermissionsPanel } from './components/effective-permissions-panel.js';
import {
    completeRoleAssignmentPairs,
    RoleAssignmentsEditor,
} from './components/role-assignments-editor.js';

const pageId = 'administrator-detail';

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
    errorComponent: ({ error }) => <ErrorPage message={error.message} />,
});

function AdministratorDetailPage() {
    const params = Route.useParams();
    const navigate = useNavigate();
    const creatingNewEntity = params.id === NEW_ENTITY_PATH;
    const { t } = useLingui();

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
                roleAssignments: entity.user.roleAssignments.map(({ roleId, channelId }) => ({
                    roleId,
                    channelId,
                })),
            };
        },
        // The generated form seeds the roleAssignments list with one blank item and the
        // deprecated roleIds with []; incomplete pairs must not reach the replace-set input,
        // and roleIds is mutually exclusive with roleAssignments so it must not be sent.
        transformCreateInput: input => {
            const transformed = {
                ...input,
                roleAssignments: completeRoleAssignmentPairs(input.roleAssignments),
            };
            delete transformed.roleIds;
            return transformed;
        },
        transformUpdateInput: input => {
            const transformed = {
                ...input,
                password: input.password || undefined,
                roleAssignments: completeRoleAssignmentPairs(input.roleAssignments),
            };
            delete transformed.roleIds;
            return transformed;
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
    const roleAssignments = form.watch('roleAssignments');

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
                            render={({ field }) => <Input placeholder="" type="password" {...field} />}
                        />
                    </div>
                </PageBlock>
                <CustomFieldsPageBlock column="main" entityType="Administrator" control={form.control} />
                <PageBlock column="main" blockId="roles" title={<Trans>Roles</Trans>}>
                    <FormFieldWrapper
                        control={form.control}
                        name="roleAssignments"
                        render={({ field }) => (
                            <RoleAssignmentsEditor value={field.value ?? []} onChange={field.onChange} />
                        )}
                    />
                    <EffectivePermissionsPanel
                        assignments={roleAssignments ?? []}
                        description={
                            <Trans>
                                What this administrator can do on the selected channel, derived
                                from the roles assigned above. Edit the roles to change it.
                            </Trans>
                        }
                    />
                </PageBlock>
            </PageLayout>
        </Page>
    );
}
