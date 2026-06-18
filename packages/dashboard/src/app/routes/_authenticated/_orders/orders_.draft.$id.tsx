import { ConfirmationDialog } from '@/vdb/components/shared/confirmation-dialog.js';
import { CustomFieldsForm } from '@/vdb/components/shared/custom-fields-form.js';
import { CustomerSelector } from '@/vdb/components/shared/customer-selector.js';
import { ErrorPage } from '@/vdb/components/shared/error-page.js';
import { Button } from '@/vdb/components/ui/button.js';
import { Form } from '@/vdb/components/ui/form.js';
import { addCustomFields } from '@/vdb/framework/document-introspection/add-custom-fields.js';
import { useGeneratedForm } from '@/vdb/framework/form-engine/use-generated-form.js';
import {
    Page,
    PageActionBar,
    PageBlock,
    PageLayout,
    PageTitle,
} from '@/vdb/framework/layout-engine/page-layout.js';
import { ActionBarItem } from '@/vdb/framework/layout-engine/action-bar-item-wrapper.js';
import { useDetailPage } from '@/vdb/framework/page/use-detail-page.js';
import { api } from '@/vdb/graphql/api.js';
import { Trans, useLingui } from '@lingui/react/macro';
import { useMutation, useQuery } from '@tanstack/react-query';
import { createFileRoute, Link, useNavigate } from '@tanstack/react-router';
import { ResultOf } from 'gql.tada';
import { User } from 'lucide-react';
import { toast } from 'sonner';
import { CustomerAddressSelector } from './components/customer-address-selector.js';
import { DraftOrderStatus } from './components/draft-order-status.js';
import { EditOrderTable } from './components/edit-order-table.js';
import { OrderAddress } from './components/order-address.js';
import {
    addItemToDraftOrderDocument,
    adjustDraftOrderLineDocument,
    applyCouponCodeToDraftOrderDocument,
    deleteDraftOrderDocument,
    draftOrderEligibleShippingMethodsDocument,
    orderDetailDocument,
    removeCouponCodeFromDraftOrderDocument,
    removeDraftOrderLineDocument,
    setBillingAddressForDraftOrderDocument,
    setCustomerForDraftOrderDocument,
    setDraftOrderCustomFieldsDocument,
    setDraftOrderShippingMethodDocument,
    setShippingAddressForDraftOrderDocument,
    transitionOrderToStateDocument,
    unsetBillingAddressForDraftOrderDocument,
    unsetShippingAddressForDraftOrderDocument,
} from './orders.graphql.js';
import { loadDraftOrder } from './utils/order-detail-loaders.js';

export const Route = createFileRoute('/_authenticated/_orders/orders_/draft/$id')({
    component: DraftOrderPage,
    loader: ({ context, params }) => loadDraftOrder(context, params),
    errorComponent: ({ error }) => <ErrorPage message={error.message} />,
});

function DraftOrderPage() {
    const params = Route.useParams();
    const { t } = useLingui();
    const navigate = useNavigate();

    const { entity, refreshEntity, form } = useDetailPage({
        queryDocument: addCustomFields(orderDetailDocument, {
            includeNestedFragments: ['OrderLine', 'Fulfillment'],
        }),
        setValuesForUpdate: entity => {
            return {
                id: entity.id,
                customFields: entity.customFields,
            };
        },
        params: { id: params.id },
    });

    const { form: orderCustomFieldsForm } = useGeneratedForm({
        document: setDraftOrderCustomFieldsDocument,
        varName: undefined,
        entity: entity,
        setValues: entity => {
            return {
                orderId: entity.id,
                input: {
                    id: entity.id,
                    customFields: entity.customFields,
                },
            };
        },
    });

    const { mutate: setDraftOrderCustomFields } = useMutation({
        mutationFn: api.mutate(setDraftOrderCustomFieldsDocument),
        onSuccess: (result: ResultOf<typeof setDraftOrderCustomFieldsDocument>) => {
            toast.success(t`Order custom fields updated`);
            refreshEntity();
        },
        onError: error => {
            toast.error(t`Failed to update order custom fields: ${error.message}`);
        },
    });

    const { data: eligibleShippingMethods } = useQuery({
        queryKey: ['eligibleShippingMethods', entity?.id],
        queryFn: () => api.query(draftOrderEligibleShippingMethodsDocument, { orderId: entity?.id ?? '' }),
        enabled: !!entity?.shippingAddress?.streetLine1,
    });

    const { mutate: addItemToDraftOrder } = useMutation({
        mutationFn: api.mutate(addItemToDraftOrderDocument),
        onSuccess: (result: ResultOf<typeof addItemToDraftOrderDocument>) => {
            const order = result.addItemToDraftOrder;
            switch (order.__typename) {
                case 'Order':
                    toast.success(t`Item added to order`);
                    refreshEntity();
                    break;
                default:
                    toast.error(order.message);
                    break;
            }
        },
        onError: error => {
            if ((error as any).extensions?.code === 'ENTITY_NOT_FOUND') {
                toast.error(t`The variant could not be added. Ensure the parent product is enabled.`);
            }
        },
    });

    const { mutate: adjustDraftOrderLine } = useMutation({
        mutationFn: api.mutate(adjustDraftOrderLineDocument),
        onSuccess: (result: ResultOf<typeof adjustDraftOrderLineDocument>) => {
            const order = result.adjustDraftOrderLine;
            switch (order.__typename) {
                case 'Order':
                    toast.success(t`Order line updated`);
                    refreshEntity();
                    break;
                default:
                    toast.error(order.message);
                    break;
            }
        },
        onError: error => {
            toast.error(t`Failed to update order line: ${error.message}`);
        },
    });

    const { mutate: removeDraftOrderLine } = useMutation({
        mutationFn: api.mutate(removeDraftOrderLineDocument),
        onSuccess: (result: ResultOf<typeof removeDraftOrderLineDocument>) => {
            const order = result.removeDraftOrderLine;
            switch (order.__typename) {
                case 'Order':
                    toast.success(t`Order line removed`);
                    refreshEntity();
                    break;
                default:
                    toast.error(order.message);
                    break;
            }
        },
        onError: error => {
            toast.error(t`Failed to remove order line: ${error.message}`);
        },
    });

    const { mutate: setCustomerForDraftOrder } = useMutation({
        mutationFn: api.mutate(setCustomerForDraftOrderDocument),
        onSuccess: (result: ResultOf<typeof setCustomerForDraftOrderDocument>) => {
            const order = result.setCustomerForDraftOrder;
            switch (order.__typename) {
                case 'Order':
                    toast.success(t`Customer set for order`);

                    // When we change the customer, we should clear
                    // any selected shipping/billing address
                    if (entity?.shippingAddress) {
                        unsetShippingAddressForDraftOrder({ orderId: entity.id });
                    }
                    if (entity?.billingAddress) {
                        unsetBillingAddressForDraftOrder({ orderId: entity.id });
                    }
                    refreshEntity();
                    break;
                default:
                    toast.error(order.message);
                    break;
            }
        },
        onError: error => {
            toast.error(t`Failed to set customer for order: ${error.message}`);
        },
    });

    const { mutate: setShippingAddressForDraftOrder } = useMutation({
        mutationFn: api.mutate(setShippingAddressForDraftOrderDocument),
        onSuccess: (result: ResultOf<typeof setShippingAddressForDraftOrderDocument>) => {
            toast.success(t`Shipping address set for order`);
            refreshEntity();
        },
        onError: error => {
            toast.error(t`Failed to set shipping address for order: ${error.message}`);
        },
    });

    const { mutate: setBillingAddressForDraftOrder } = useMutation({
        mutationFn: api.mutate(setBillingAddressForDraftOrderDocument),
        onSuccess: (result: ResultOf<typeof setBillingAddressForDraftOrderDocument>) => {
            toast.success(t`Billing address set for order`);
            refreshEntity();
        },
        onError: error => {
            toast.error(t`Failed to set billing address for order: ${error.message}`);
        },
    });

    const { mutate: unsetShippingAddressForDraftOrder } = useMutation({
        mutationFn: api.mutate(unsetShippingAddressForDraftOrderDocument),
        onSuccess: (result: ResultOf<typeof unsetShippingAddressForDraftOrderDocument>) => {
            toast.success(t`Shipping address unset for order`);
            refreshEntity();
        },
        onError: error => {
            toast.error(t`Failed to unset shipping address for order: ${error.message}`);
        },
    });

    const { mutate: unsetBillingAddressForDraftOrder } = useMutation({
        mutationFn: api.mutate(unsetBillingAddressForDraftOrderDocument),
        onSuccess: (result: ResultOf<typeof unsetBillingAddressForDraftOrderDocument>) => {
            toast.success(t`Billing address unset for order`);
            refreshEntity();
        },
        onError: error => {
            toast.error(t`Failed to unset billing address for order: ${error.message}`);
        },
    });

    const { mutate: setShippingMethodForDraftOrder } = useMutation({
        mutationFn: api.mutate(setDraftOrderShippingMethodDocument),
        onSuccess: (result: ResultOf<typeof setDraftOrderShippingMethodDocument>) => {
            const order = result.setDraftOrderShippingMethod;
            switch (order.__typename) {
                case 'Order':
                    toast.success(t`Shipping method set for order`);
                    refreshEntity();
                    break;
                default:
                    toast.error(order.message);
                    break;
            }
        },
        onError: error => {
            toast.error(t`Failed to set shipping method for order: ${error.message}`);
        },
    });

    const { mutate: setCouponCodeForDraftOrder } = useMutation({
        mutationFn: api.mutate(applyCouponCodeToDraftOrderDocument),
        onSuccess: (result: ResultOf<typeof applyCouponCodeToDraftOrderDocument>) => {
            const order = result.applyCouponCodeToDraftOrder;
            switch (order.__typename) {
                case 'Order':
                    toast.success(t`Coupon code set for order`);
                    refreshEntity();
                    break;
                default:
                    toast.error(order.message);
                    break;
            }
        },
        onError: error => {
            toast.error(t`Failed to set coupon code for order: ${error.message}`);
        },
    });

    const { mutate: removeCouponCodeForDraftOrder } = useMutation({
        mutationFn: api.mutate(removeCouponCodeFromDraftOrderDocument),
        onSuccess: (result: ResultOf<typeof removeCouponCodeFromDraftOrderDocument>) => {
            toast.success(t`Coupon code removed from order`);
            refreshEntity();
        },
        onError: error => {
            toast.error(t`Failed to remove coupon code from order: ${error.message}`);
        },
    });

    const { mutate: completeDraftOrder } = useMutation({
        mutationFn: api.mutate(transitionOrderToStateDocument),
        onSuccess: async (result: ResultOf<typeof transitionOrderToStateDocument>) => {
            const order = result.transitionOrderToState;
            switch (order?.__typename) {
                case 'Order':
                    toast.success(t`Draft order completed`);
                    refreshEntity();
                    setTimeout(() => {
                        navigate({ to: `/orders/$id`, params: { id: order.id } });
                    }, 500);
                    break;
                default:
                    toast.error(order ? order.message : 'Unknown error');
                    break;
            }
        },
        onError: error => {
            toast.error(t`Failed to complete draft order: ${error.message}`);
        },
    });

    const { mutate: deleteDraftOrder } = useMutation({
        mutationFn: api.mutate(deleteDraftOrderDocument),
        onSuccess: (result: ResultOf<typeof deleteDraftOrderDocument>) => {
            if (result.deleteDraftOrder.result === 'DELETED') {
                toast.success(t`Draft order deleted`);
                navigate({ to: '/orders' });
            } else {
                toast.error(result.deleteDraftOrder.message);
            }
        },
        onError: error => {
            toast.error(t`Failed to delete draft order: ${error.message}`);
        },
    });

    if (!entity) {
        return null;
    }

    const onSaveCustomFields = (values: any) => {
        setDraftOrderCustomFields({
            input: { id: entity.id, customFields: values.input?.customFields },
            orderId: entity.id,
        });
    };

    const hasCustomer = !!entity.customer;
    const hasLines = entity.lines.length > 0;
    const hasShippingMethod = entity.shippingLines.length > 0;
    const isDraftState = entity.state === 'Draft';

    const isCompleteDraftDisabled = !hasCustomer || !hasLines || !hasShippingMethod || !isDraftState;

    return (
        <Page pageId="draft-order-detail" form={form} entity={entity}>
            <PageTitle>
                <Trans>Draft order</Trans>: {entity?.code ?? ''}
            </PageTitle>
            <PageActionBar>
                <ActionBarItem itemId="delete-button" requiresPermission={['DeleteOrder']}>
                    <ConfirmationDialog
                        title={t`Delete draft order`}
                        description={t`Are you sure you want to delete this draft order?`}
                        onConfirm={() => {
                            deleteDraftOrder({ orderId: entity.id });
                        }}
                    >
                        <Button variant="destructive" type="button">
                            <Trans>Delete draft</Trans>
                        </Button>
                    </ConfirmationDialog>
                </ActionBarItem>
                <ActionBarItem itemId="complete-draft-button" requiresPermission={['UpdateOrder']}>
                    <Button
                        type="button"
                        disabled={isCompleteDraftDisabled}
                        onClick={() => completeDraftOrder({ id: entity.id, state: 'ArrangingPayment' })}
                    >
                        <Trans>Complete draft</Trans>
                    </Button>
                </ActionBarItem>
            </PageActionBar>

            <PageLayout>
                <PageBlock
                    column="side"
                    blockId="draft-order-status"
                    title={<Trans>Draft order status</Trans>}
                >
                    <DraftOrderStatus
                        hasCustomer={hasCustomer}
                        hasLines={hasLines}
                        hasShippingMethod={hasShippingMethod}
                        isDraftState={isDraftState}
                    />
                </PageBlock>
                <PageBlock column="main" blockId="order-table">
                    <EditOrderTable
                        order={entity}
                        eligibleShippingMethods={
                            eligibleShippingMethods?.eligibleShippingMethodsForDraftOrder ?? []
                        }
                        onSetShippingMethod={e =>
                            setShippingMethodForDraftOrder({
                                orderId: entity.id,
                                shippingMethodId: e.shippingMethodId,
                            })
                        }
                        onAddItem={e =>
                            addItemToDraftOrder({
                                orderId: entity.id,
                                input: { productVariantId: e.productVariantId, quantity: 1 },
                            })
                        }
                        onAdjustLine={e =>
                            adjustDraftOrderLine({
                                orderId: entity.id,
                                input: {
                                    orderLineId: e.lineId,
                                    quantity: e.quantity,
                                    customFields: e.customFields,
                                } as any,
                            })
                        }
                        onRemoveLine={e =>
                            removeDraftOrderLine({
                                orderId: entity.id,
                                orderLineId: e.lineId,
                            })
                        }
                        onApplyCouponCode={e =>
                            setCouponCodeForDraftOrder({
                                orderId: entity.id,
                                couponCode: e.couponCode,
                            })
                        }
                        onRemoveCouponCode={e =>
                            removeCouponCodeForDraftOrder({
                                orderId: entity.id,
                                couponCode: e.couponCode,
                            })
                        }
                    />
                </PageBlock>
                <PageBlock column="main" blockId="order-custom-fields" title={<Trans>Custom fields</Trans>}>
                    <Form {...orderCustomFieldsForm}>
                        <CustomFieldsForm
                            entityType="Order"
                            control={orderCustomFieldsForm.control}
                            formPathPrefix="input"
                        />
                        <div className="mt-4">
                            <Button
                                type="submit"
                                className=""
                                disabled={
                                    !orderCustomFieldsForm.formState.isValid ||
                                    !orderCustomFieldsForm.formState.isDirty
                                }
                                onClick={e => {
                                    e.preventDefault();
                                    e.stopPropagation();
                                    onSaveCustomFields(orderCustomFieldsForm.getValues());
                                }}
                            >
                                <Trans>Set custom fields</Trans>
                            </Button>
                        </div>
                    </Form>
                </PageBlock>
                <PageBlock column="side" blockId="customer" title={<Trans>Customer</Trans>}>
                    {entity?.customer?.id ? (
                        <Button variant="outline" render={<Link to={`/customers/${entity?.customer?.id}`} />} className="mb-4">
                            <User className="w-4 h-4" />
                            {entity?.customer?.firstName} {entity?.customer?.lastName}
                        </Button>
                    ) : null}
                    <CustomerSelector
                        onSelect={customer => {
                            setCustomerForDraftOrder({ orderId: entity.id, customerId: customer.id });
                        }}
                    />
                </PageBlock>
                <PageBlock column="side" blockId="shipping-address" title={<Trans>Shipping address</Trans>}>
                    <div className="flex flex-col">
                        <OrderAddress address={entity.shippingAddress ?? undefined} />
                        {entity.shippingAddress?.streetLine1 ? (
                            <RemoveAddressButton
                                onClick={() => unsetShippingAddressForDraftOrder({ orderId: entity.id })}
                            />
                        ) : (
                            <div className="mt-4">
                                <CustomerAddressSelector
                                    customerId={entity.customer?.id}
                                    onSelect={address => {
                                        setShippingAddressForDraftOrder({
                                            orderId: entity.id,
                                            input: {
                                                fullName: address.fullName,
                                                company: address.company,
                                                streetLine1: address.streetLine1,
                                                streetLine2: address.streetLine2,
                                                city: address.city,
                                                province: address.province,
                                                postalCode: address.postalCode,
                                                countryCode: address.country.code,
                                                phoneNumber: address.phoneNumber,
                                            },
                                        });
                                    }}
                                />
                            </div>
                        )}
                    </div>
                </PageBlock>
                <PageBlock column="side" blockId="billing-address" title={<Trans>Billing address</Trans>}>
                    <div className="flex flex-col">
                        <OrderAddress address={entity.billingAddress ?? undefined} />
                        {entity.billingAddress?.streetLine1 ? (
                            <RemoveAddressButton
                                onClick={() => unsetBillingAddressForDraftOrder({ orderId: entity.id })}
                            />
                        ) : (
                            <div className="mt-4">
                                <CustomerAddressSelector
                                    customerId={entity.customer?.id}
                                    onSelect={address => {
                                        setBillingAddressForDraftOrder({
                                            orderId: entity.id,
                                            input: {
                                                fullName: address.fullName,
                                                company: address.company,
                                                streetLine1: address.streetLine1,
                                                streetLine2: address.streetLine2,
                                                city: address.city,
                                                province: address.province,
                                                postalCode: address.postalCode,
                                                countryCode: address.country.code,
                                                phoneNumber: address.phoneNumber,
                                            },
                                        });
                                    }}
                                />
                            </div>
                        )}
                    </div>
                </PageBlock>
            </PageLayout>
        </Page>
    );
}

function RemoveAddressButton(props: { onClick: () => void }) {
    return (
        <div className="">
            <Button variant="outline" className="mt-4" size="sm" onClick={props.onClick}>
                <Trans>Remove</Trans>
            </Button>
        </div>
    );
}
