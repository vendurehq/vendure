import { ErrorPage } from '@/vdb/components/shared/error-page.js';
import { FormFieldWrapper } from '@/vdb/components/shared/form-field-wrapper.js';
import { Button } from '@/vdb/components/ui/button.js';
import { Input } from '@/vdb/components/ui/input.js';
import { NEW_ENTITY_PATH } from '@/vdb/constants.js';
import {    CustomFieldsPageBlock,
    DetailFormGrid,
    Page,
    PageActionBar,
    PageBlock,
    PageLayout,
    PageTitle,
} from '@/vdb/framework/layout-engine/page-layout.js';
import { ActionBarItem } from '@/vdb/framework/layout-engine/action-bar-item-wrapper.js';
import { detailPageRouteLoader } from '@/vdb/framework/page/detail-page-route-loader.js';
import { useDetailPage } from '@/vdb/framework/page/use-detail-page.js';
import { Trans, useLingui } from '@lingui/react/macro';
import { createFileRoute, useNavigate } from '@tanstack/react-router';
import { toast } from 'sonner';
import { CustomerGroupMembersTable } from './components/customer-group-members-table.js';
import {
    createCustomerGroupDocument,
    customerGroupDetailDocument,
    updateCustomerGroupDocument,
} from './customer-groups.graphql.js';

const pageId = 'customer-group-detail';

export const Route = createFileRoute('/_authenticated/_customer-groups/customer-groups_/$id')({
    component: CustomerGroupDetailPage,
    loader: detailPageRouteLoader({
        pageId,
        queryDocument: customerGroupDetailDocument,
        breadcrumb: (isNew, entity) => [
            { path: '/customer-groups', label: <Trans>Customer Groups</Trans> },
            isNew ? <Trans>New customer group</Trans> : entity?.name,
        ],
    }),
    errorComponent: ({ error }) => <ErrorPage message={error.message} />,
});

function CustomerGroupDetailPage() {
    const params = Route.useParams();
    const navigate = useNavigate();
    const creatingNewEntity = params.id === NEW_ENTITY_PATH;
    const { t } = useLingui();

    const { form, submitHandler, entity, isPending, resetForm } = useDetailPage({
        pageId,
        queryDocument: customerGroupDetailDocument,
        createDocument: createCustomerGroupDocument,
        updateDocument: updateCustomerGroupDocument,
        setValuesForUpdate: entity => {
            return {
                id: entity.id,
                name: entity.name,
                customFields: entity.customFields,
            };
        },
        params: { id: params.id },
        onSuccess: async data => {
            toast.success(
                creatingNewEntity
                    ? t`Successfully created customer group`
                    : t`Successfully updated customer group`,
            );
            resetForm();
            if (creatingNewEntity && data?.id) {
                await navigate({ to: `../$id`, params: { id: data.id } });
            }
        },
        onError: err => {
            toast.error(
                creatingNewEntity ? t`Failed to create customer group` : t`Failed to update customer group`,
                {
                    description: err instanceof Error ? err.message : 'Unknown error',
                },
            );
        },
    });

    return (
        <Page pageId={pageId} form={form} submitHandler={submitHandler} entity={entity}>
            <PageTitle>
                {creatingNewEntity ? <Trans>New customer group</Trans> : (entity?.name ?? '')}
            </PageTitle>
            <PageActionBar>
                <ActionBarItem itemId="save-button" requiresPermission={['UpdateCustomerGroup']}>
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
                            name="name"
                            label={<Trans>Name</Trans>}
                            render={({ field }) => <Input placeholder="" {...field} />}
                        />
                    </DetailFormGrid>
                </PageBlock>
                <CustomFieldsPageBlock column="main" entityType="CustomerGroup" control={form.control} />
                {entity && (
                    <PageBlock column="main" blockId="customers" title={<Trans>Customers</Trans>}>
                        <CustomerGroupMembersTable customerGroupId={entity?.id} />
                    </PageBlock>
                )}
            </PageLayout>
        </Page>
    );
}
