import { ErrorPage } from '@/vdb/components/shared/error-page.js';
import { Button } from '@/vdb/components/ui/button.js';
import { FormFieldWrapper } from '@/vdb/components/shared/form-field-wrapper.js';
import { Input } from '@/vdb/components/ui/input.js';
import { NEW_ENTITY_PATH } from '@/vdb/constants.js';
import {    CustomFieldsPageBlock,
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
import { createSellerDocument, sellerDetailDocument, updateSellerDocument } from './sellers.graphql.js';

const pageId = 'seller-detail';

export const Route = createFileRoute('/_authenticated/_sellers/sellers_/$id')({
    component: SellerDetailPage,
    loader: detailPageRouteLoader({
        pageId,
        queryDocument: sellerDetailDocument,
        breadcrumb: (isNew, entity) => [
            { path: '/sellers', label: <Trans>Sellers</Trans> },
            isNew ? <Trans>New seller</Trans> : entity?.name,
        ],
    }),
    errorComponent: ({ error }) => <ErrorPage message={error.message} />,
});

function SellerDetailPage() {
    const params = Route.useParams();
    const navigate = useNavigate();
    const creatingNewEntity = params.id === NEW_ENTITY_PATH;
    const { t } = useLingui();

    const { form, submitHandler, entity, isPending, resetForm } = useDetailPage({
        pageId,
        queryDocument: sellerDetailDocument,
        createDocument: createSellerDocument,
        updateDocument: updateSellerDocument,
        setValuesForUpdate: entity => {
            return {
                id: entity.id,
                name: entity.name,
                customFields: entity.customFields,
            };
        },
        params: { id: params.id },
        onSuccess: async data => {
            toast(creatingNewEntity ? t`Successfully created seller` : t`Successfully updated seller`);
            form.reset(form.getValues());
            if (creatingNewEntity) {
                await navigate({ to: `../$id`, params: { id: data.id } });
            }
        },
        onError: err => {
            toast(creatingNewEntity ? t`Failed to create seller` : t`Failed to update seller`, {
                description: err instanceof Error ? err.message : 'Unknown error',
            });
        },
    });

    return (
        <Page pageId={pageId} form={form} submitHandler={submitHandler} entity={entity}>
            <PageTitle>{creatingNewEntity ? <Trans>New seller</Trans> : (entity?.name ?? '')}</PageTitle>
            <PageActionBar>
                <ActionBarItem itemId="save-button" requiresPermission={['UpdateSeller']}>
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
                    <div className="md:flex w-full gap-4">
                        <div className="w-1/2">
                            <FormFieldWrapper
                                control={form.control}
                                name="name"
                                label={<Trans>Name</Trans>}
                                render={({ field }) => <Input placeholder="" {...field} />}
                            />
                        </div>
                    </div>
                </PageBlock>
                <CustomFieldsPageBlock column="main" entityType="Seller" control={form.control} />
            </PageLayout>
        </Page>
    );
}
