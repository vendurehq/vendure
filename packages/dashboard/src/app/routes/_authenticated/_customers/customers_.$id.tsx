import { CustomerGroupChip } from '@/vdb/components/shared/customer-group-chip.js';
import { CustomerGroupSelector } from '@/vdb/components/shared/customer-group-selector.js';
import { ErrorPage } from '@/vdb/components/shared/error-page.js';
import { FormFieldWrapper } from '@/vdb/components/shared/form-field-wrapper.js';
import { Button } from '@/vdb/components/ui/button.js';
import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogHeader,
    DialogTitle,
    DialogTrigger,
} from '@/vdb/components/ui/dialog.js';
import { Input } from '@/vdb/components/ui/input.js';
import { NEW_ENTITY_PATH } from '@/vdb/constants.js';
import { addCustomFields } from '@/vdb/framework/document-introspection/add-custom-fields.js';
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
import { api } from '@/vdb/graphql/api.js';
import { Trans, useLingui } from '@lingui/react/macro';
import { useMutation } from '@tanstack/react-query';
import { createFileRoute, useNavigate } from '@tanstack/react-router';
import { Plus } from 'lucide-react';
import { useState } from 'react';
import { toast } from 'sonner';
import { CustomerAddressCard } from './components/customer-address-card.js';
import { CustomerAddressForm } from './components/customer-address-form.js';
import { CustomerHistoryContainer } from './components/customer-history/customer-history-container.js';
import { CustomerOrderTable } from './components/customer-order-table.js';
import { CustomerStatusBadge } from './components/customer-status-badge.js';
import {
    addCustomerToGroupDocument,
    createCustomerAddressDocument,
    createCustomerDocument,
    customerDetailDocument,
    removeCustomerFromGroupDocument,
    updateCustomerDocument,
} from './customers.graphql.js';

const pageId = 'customer-detail';

export const Route = createFileRoute('/_authenticated/_customers/customers_/$id')({
    component: CustomerDetailPage,
    loader: detailPageRouteLoader({
        pageId,
        queryDocument: () =>
            addCustomFields(customerDetailDocument, {
                includeNestedFragments: ['Address'],
            }),
        breadcrumb: (isNew, entity) => [
            { path: '/customers', label: <Trans>Customers</Trans> },
            isNew ? <Trans>New customer</Trans> : `${entity?.firstName} ${entity?.lastName}`,
        ],
    }),
    errorComponent: ({ error }) => <ErrorPage message={error.message} />,
});

function CustomerDetailPage() {
    const params = Route.useParams();
    const navigate = useNavigate();
    const creatingNewEntity = params.id === NEW_ENTITY_PATH;
    const { t } = useLingui();
    const [newAddressOpen, setNewAddressOpen] = useState(false);

    const { form, submitHandler, entity, isPending, refreshEntity, resetForm } = useDetailPage({
        pageId,
        queryDocument: addCustomFields(customerDetailDocument, {
            includeNestedFragments: ['Address'],
        }),
        createDocument: createCustomerDocument,
        updateDocument: updateCustomerDocument,
        setValuesForUpdate: entity => {
            return {
                id: entity.id,
                title: entity.title,
                emailAddress: entity.emailAddress,
                firstName: entity.firstName,
                lastName: entity.lastName,
                phoneNumber: entity.phoneNumber,
                addresses: entity.addresses,
                customFields: entity.customFields,
            };
        },
        params: { id: params.id },
        onSuccess: async data => {
            if (data.__typename === 'Customer') {
                toast.success(
                    creatingNewEntity ? t`Successfully created customer` : t`Successfully updated customer`,
                );
                resetForm();
                if (creatingNewEntity) {
                    await navigate({ to: `../$id`, params: { id: data.id } });
                }
            } else {
                toast.error(creatingNewEntity ? t`Failed to create customer` : t`Failed to update customer`, {
                    description: data.message,
                });
            }
        },
        onError: err => {
            toast.error(creatingNewEntity ? t`Failed to create customer` : t`Failed to update customer`, {
                description: err instanceof Error ? err.message : 'Unknown error',
            });
        },
    });

    const { mutate: createAddress } = useMutation({
        mutationFn: api.mutate(createCustomerAddressDocument),
        onSuccess: () => {
            setNewAddressOpen(false);
            refreshEntity();
        },
        onError: () => {
            toast.error(t`Failed to create address`);
        },
    });

    const { mutate: addCustomerToGroup } = useMutation({
        mutationFn: api.mutate(addCustomerToGroupDocument),
        onSuccess: () => {
            refreshEntity();
        },
        onError: () => {
            toast(t`Failed to add customer to group`);
        },
    });

    const { mutate: removeCustomerFromGroup } = useMutation({
        mutationFn: api.mutate(removeCustomerFromGroupDocument),
        onSuccess: () => {
            refreshEntity();
        },
        onError: () => {
            toast(t`Failed to remove customer from group`);
        },
    });

    const customerName = entity ? `${entity.firstName} ${entity.lastName}` : '';

    return (
        <Page pageId={pageId} form={form} submitHandler={submitHandler} entity={entity}>
            <PageTitle>{creatingNewEntity ? <Trans>New customer</Trans> : customerName}</PageTitle>
            <PageActionBar>
                <ActionBarItem itemId="save-button" requiresPermission={['UpdateCustomer']}>
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
                            name="title"
                            label={<Trans>Title</Trans>}
                            render={({ field }) => <Input {...field} />}
                        />
                        <div></div>
                        <FormFieldWrapper
                            control={form.control}
                            name="firstName"
                            label={<Trans>First name</Trans>}
                            render={({ field }) => <Input {...field} />}
                        />
                        <FormFieldWrapper
                            control={form.control}
                            name="lastName"
                            label={<Trans>Last name</Trans>}
                            render={({ field }) => <Input {...field} />}
                        />
                        <FormFieldWrapper
                            control={form.control}
                            name="emailAddress"
                            label={<Trans>Email address</Trans>}
                            render={({ field }) => <Input {...field} />}
                        />
                        <FormFieldWrapper
                            control={form.control}
                            name="phoneNumber"
                            label={<Trans>Phone number</Trans>}
                            render={({ field }) => <Input {...field} />}
                        />
                    </DetailFormGrid>
                </PageBlock>
                <CustomFieldsPageBlock column="main" entityType="Customer" control={form.control} />

                {entity && (
                    <>
                        <PageBlock column="main" blockId="addresses" title={<Trans>Addresses</Trans>}>
                            <DetailFormGrid>
                                {entity?.addresses?.map(address => (
                                    <CustomerAddressCard
                                        key={address.id}
                                        address={address}
                                        editable
                                        deletable
                                        onUpdate={() => {
                                            refreshEntity();
                                        }}
                                        onDelete={() => {
                                            refreshEntity();
                                        }}
                                    />
                                ))}
                            </DetailFormGrid>

                            <Dialog open={newAddressOpen} onOpenChange={setNewAddressOpen}>
                                <DialogTrigger render={<Button variant="outline" />}>
                                    <Plus className="w-4 h-4" /> <Trans>Add new address</Trans>
                                </DialogTrigger>
                                <DialogContent className="max-h-[90vh] overflow-y-auto">
                                    <DialogHeader>
                                        <DialogTitle>
                                            <Trans>Add new address</Trans>
                                        </DialogTitle>
                                        <DialogDescription>
                                            <Trans>Add a new address to the customer.</Trans>
                                        </DialogDescription>
                                    </DialogHeader>
                                    <CustomerAddressForm
                                        onSubmit={values => {
                                            const { id, ...input } = values;
                                            createAddress({
                                                customerId: entity.id,
                                                input,
                                            });
                                        }}
                                    />
                                </DialogContent>
                            </Dialog>
                        </PageBlock>

                        <PageBlock column="main" blockId="orders" title={<Trans>Orders</Trans>}>
                            <CustomerOrderTable customerId={entity.id} />
                        </PageBlock>
                        <PageBlock column="main" blockId="history" title={<Trans>Customer history</Trans>}>
                            <CustomerHistoryContainer customerId={entity.id} />
                        </PageBlock>
                        <PageBlock column="side" blockId="status" title={<Trans>Status</Trans>}>
                            <CustomerStatusBadge user={entity.user} />
                        </PageBlock>
                        <PageBlock column="side" blockId="groups" title={<Trans>Customer groups</Trans>}>
                            <div
                                className={`flex flex-col gap-2 ${entity?.groups?.length > 0 ? 'mb-2' : ''}`}
                            >
                                {entity?.groups?.map(group => (
                                    <CustomerGroupChip
                                        key={group.id}
                                        group={group}
                                        onRemove={groupId =>
                                            removeCustomerFromGroup({ customerId: entity.id, groupId })
                                        }
                                    />
                                ))}
                            </div>
                            <CustomerGroupSelector
                                onSelect={group =>
                                    addCustomerToGroup({ customerId: entity.id, groupId: group.id })
                                }
                            />
                        </PageBlock>
                    </>
                )}
            </PageLayout>
        </Page>
    );
}
