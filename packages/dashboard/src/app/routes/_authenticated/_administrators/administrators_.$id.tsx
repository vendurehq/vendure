import { ErrorPage } from '@/vdb/components/shared/error-page.js';
import { FormFieldWrapper } from '@/vdb/components/shared/form-field-wrapper.js';
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
import { Trans, useLingui } from '@lingui/react/macro';
import { createFileRoute, useNavigate } from '@tanstack/react-router';
import { UseFormReturn } from 'react-hook-form';
import { toast } from 'sonner';
import {
    administratorDetailDocument,
    createAdministratorDocument,
    updateAdministratorDocument,
} from './administrators.graphql.js';
import { completeRoleAssignmentPairs, RoleAssignmentPair } from './components/role-assignments-editor.js';
import { RolesPageBlock } from './components/roles-page-block.js';

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
    errorComponent: ({ error }) => <ErrorPage error={error} />,
});

function AdministratorDetailPage() {
    const params = Route.useParams();
    const navigate = useNavigate();
    const creatingNewEntity = params.id === NEW_ENTITY_PATH;
    const { t } = useLingui();

    const { form, submitHandler, entity, isPending, resetForm, refreshEntity } = useDetailPage({
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
            };
        },
        // The generated form seeds the deprecated roleIds list with []; sent as-is it would
        // strip the roles on the active channel. roleIds is also mutually exclusive with
        // roleAssignments on creation. Incomplete editor rows must not reach the input.
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
    // useDetailPage types the form on the update input, and roleAssignments is a creation
    // input only: once the administrator exists, assignments are edited through their own
    // mutations (RolesPageBlock), not through updateAdministrator.
    const createForm = form as unknown as UseFormReturn<{ roleAssignments: RoleAssignmentPair[] }>;

    const name = `${entity?.firstName} ${entity?.lastName}`;

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
                <RolesPageBlock
                    column="main"
                    createForm={creatingNewEntity ? createForm : undefined}
                    user={entity?.user}
                    onChange={refreshEntity}
                />
            </PageLayout>
        </Page>
    );
}
