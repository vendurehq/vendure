import { ErrorPage } from '@/vdb/components/shared/error-page.js';
import { FormFieldWrapper } from '@/vdb/components/shared/form-field-wrapper.js';
import { Button } from '@/vdb/components/ui/button.js';
import { Input } from '@/vdb/components/ui/input.js';
import { NEW_ENTITY_PATH } from '@/vdb/constants.js';
import { ActionBarItem } from '@/vdb/framework/layout-engine/action-bar-item-wrapper.js';
import {
    DetailFormGrid,
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
    errorComponent: ({ error }) => <ErrorPage message={error.message} />,
});

function RoleDetailPage() {
    const params = Route.useParams();
    const navigate = useNavigate();
    const creatingNewEntity = params.id === NEW_ENTITY_PATH;
    const { t } = useLingui();

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

    return (
        <Page pageId={pageId} form={form} submitHandler={submitHandler} entity={entity}>
            <PageTitle>{creatingNewEntity ? <Trans>New role</Trans> : (entity?.description ?? '')}</PageTitle>
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
                </PageBlock>
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
