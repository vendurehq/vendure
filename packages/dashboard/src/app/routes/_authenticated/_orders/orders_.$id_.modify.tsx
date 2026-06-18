import { ErrorPage } from '@/vdb/components/shared/error-page.js';
import { Button } from '@/vdb/components/ui/button.js';
import {    Page,
    PageActionBar,
    PageBlock,
    PageLayout,
    PageTitle,
} from '@/vdb/framework/layout-engine/page-layout.js';
import { ActionBarItem } from '@/vdb/framework/layout-engine/action-bar-item-wrapper.js';
import { addCustomFields } from '@/vdb/framework/document-introspection/add-custom-fields.js';
import { useCustomFieldConfig } from '@/vdb/hooks/use-custom-field-config.js';
import { getDetailQueryOptions, useDetailPage } from '@/vdb/framework/page/use-detail-page.js';
import { api } from '@/vdb/graphql/api.js';
import { Trans, useLingui } from '@lingui/react/macro';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { createFileRoute, Link, useNavigate } from '@tanstack/react-router';
import { User } from 'lucide-react';
import { useState } from 'react';
import { toast } from 'sonner';
import { AddSurchargeForm } from './components/add-surcharge-form.js';
import { CustomerAddressSelector } from './components/customer-address-selector.js';
import { EditOrderTable } from './components/edit-order-table.js';
import { OrderAddress } from './components/order-address.js';
import { OrderModificationPreviewDialog } from './components/order-modification-preview-dialog.js';
import { OrderModificationSummary } from './components/order-modification-summary.js';
import { useTransitionOrderToState } from './components/use-transition-order-to-state.js';
import { draftOrderEligibleShippingMethodsDocument, orderDetailDocument } from './orders.graphql.js';
import { loadModifyingOrder } from './utils/order-detail-loaders.js';
import { AddressFragment } from './utils/order-types.js';
import { computePendingOrder } from './utils/order-utils.js';
import { useModifyOrder } from './utils/use-modify-order.js';

const pageId = 'order-modify';

export const Route = createFileRoute('/_authenticated/_orders/orders_/$id_/modify')({
    component: ModifyOrderPage,
    loader: async ({ context, params }) => loadModifyingOrder(context, params),
    errorComponent: ({ error }) => <ErrorPage message={error.message} />,
});

function ModifyOrderPage() {
    const params = Route.useParams();
    const navigate = useNavigate({ from: '/orders/$id/modify' });
    const { t } = useLingui();
    const queryClient = useQueryClient();
    const { form, submitHandler, entity } = useDetailPage({
        pageId,
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
        onSuccess: async () => {
            toast(t`Successfully updated order`);
            form.reset(form.getValues());
        },
        onError: err => {
            toast(t`Failed to update order`, {
                description: err instanceof Error ? err.message : 'Unknown error',
            });
        },
    });

    const { data: eligibleShippingMethods } = useQuery({
        queryKey: ['eligibleShippingMethods', entity?.id],
        queryFn: () => api.query(draftOrderEligibleShippingMethodsDocument, { orderId: entity?.id ?? '' }),
        enabled: !!entity?.shippingAddress?.streetLine1,
    });

    const { transitionToPreModifyingState, ManuallySelectNextState, selectNextState, transitionToState } =
        useTransitionOrderToState(entity?.id ?? '');

    const orderLineCustomFields = useCustomFieldConfig('OrderLine');

    const {
        modifyOrderInput,
        addedVariants,
        addItem,
        adjustLine,
        removeLine,
        setShippingMethod,
        applyCouponCode,
        removeCouponCode,
        updateShippingAddress: updateShippingAddressInInput,
        updateBillingAddress: updateBillingAddressInInput,
        addSurcharge,
        setNote,
        setRecalculateShipping,
        hasModifications,
    } = useModifyOrder(entity);

    // --- Address editing state ---
    const [editingShippingAddress, setEditingShippingAddress] = useState(false);
    const [editingBillingAddress, setEditingBillingAddress] = useState(false);

    // --- Address selection handlers ---
    function handleSelectShippingAddress(address: AddressFragment) {
        updateShippingAddressInInput(address);
        setEditingShippingAddress(false);
    }

    function handleSelectBillingAddress(address: AddressFragment) {
        updateBillingAddressInInput(address);
        setEditingBillingAddress(false);
    }

    const [previewOpen, setPreviewOpen] = useState(false);

    if (!entity) {
        return null;
    }

    const pendingOrder = computePendingOrder(
        entity,
        modifyOrderInput,
        addedVariants,
        eligibleShippingMethods?.eligibleShippingMethodsForDraftOrder,
        orderLineCustomFields.map(f => f.name),
    );

    // On successful state transition, invalidate the order detail query and navigate to the order detail page
    const onSuccess = async () => {
        const queryKey = getDetailQueryOptions(orderDetailDocument, { id: entity.id }).queryKey;
        await queryClient.invalidateQueries({ queryKey });
        await navigate({ to: `/orders/$id`, params: { id: entity?.id } });
    };

    const handleCancelModificationClick = async () => {
        const transitionError = await transitionToPreModifyingState();
        if (!transitionError) {
            onSuccess();
        } else {
            selectNextState({ onSuccess });
        }
    };

    const handleModificationSubmit = async (priceDifference?: number) => {
        if (priceDifference === undefined) {
            // the preview was cancelled
            setPreviewOpen(false);
        } else {
            const transitionError =
                priceDifference > 0
                    ? await transitionToState('ArrangingAdditionalPayment')
                    : await transitionToPreModifyingState();
            if (!transitionError) {
                const queryKey = getDetailQueryOptions(orderDetailDocument, { id: entity.id }).queryKey;
                await queryClient.invalidateQueries({ queryKey });
                setPreviewOpen(false);
                await navigate({ to: `/orders/$id`, params: { id: entity?.id } });
            } else {
                selectNextState({ onSuccess });
            }
        }
    };

    const shippingAddress = modifyOrderInput.updateShippingAddress ?? entity.shippingAddress;
    const billingAddress = modifyOrderInput.updateBillingAddress ?? entity.billingAddress;

    return (
        <Page pageId={pageId} form={form} submitHandler={submitHandler} entity={entity}>
            <PageTitle>
                <Trans>Modify order</Trans>
            </PageTitle>
            <PageActionBar>
                <ActionBarItem itemId="cancel-modification-button">
                    <Button type="button" variant="secondary" onClick={handleCancelModificationClick}>
                        <Trans>Cancel modification</Trans>
                    </Button>
                </ActionBarItem>
            </PageActionBar>
            <PageLayout>
                <PageBlock column="main" blockId="order-lines" title={<Trans>Order lines</Trans>}>
                    <EditOrderTable
                        order={pendingOrder}
                        eligibleShippingMethods={
                            eligibleShippingMethods?.eligibleShippingMethodsForDraftOrder ?? []
                        }
                        onAddItem={addItem}
                        onAdjustLine={adjustLine}
                        onRemoveLine={removeLine}
                        onSetShippingMethod={setShippingMethod}
                        onApplyCouponCode={applyCouponCode}
                        onRemoveCouponCode={removeCouponCode}
                        displayTotals={false}
                    />
                </PageBlock>

                <PageBlock column="main" blockId="add-surcharge" title={<Trans>Add surcharge</Trans>}>
                    <AddSurchargeForm onAddSurcharge={addSurcharge} />
                </PageBlock>

                <PageBlock
                    column="side"
                    blockId="modification-summary"
                    title={<Trans>Summary of modifications</Trans>}
                >
                    <OrderModificationSummary
                        originalOrder={entity}
                        modifyOrderInput={modifyOrderInput}
                        addedVariants={addedVariants}
                        eligibleShippingMethods={
                            eligibleShippingMethods?.eligibleShippingMethodsForDraftOrder?.map(m => ({
                                id: m.id,
                                name: m.name,
                            })) ?? []
                        }
                        onNoteChange={setNote}
                        onRecalculateShippingChange={setRecalculateShipping}
                    />
                    <div className="mt-4 flex justify-end">
                        <Button
                            type="button"
                            onClick={() => setPreviewOpen(true)}
                            disabled={!hasModifications}
                        >
                            <Trans>Preview changes</Trans>
                        </Button>
                    </div>
                    <OrderModificationPreviewDialog
                        open={previewOpen}
                        onOpenChange={setPreviewOpen}
                        orderSnapshot={entity}
                        modifyOrderInput={modifyOrderInput}
                        onResolve={handleModificationSubmit}
                    />
                </PageBlock>
                <PageBlock column="side" blockId="customer" title={<Trans>Customer</Trans>}>
                    {entity.customer ? (
                        <Button variant="outline" render={<Link to={`/customers/${entity?.customer?.id}`} />}>
                            <User className="w-4 h-4" />
                            {entity?.customer?.firstName} {entity?.customer?.lastName}
                        </Button>
                    ) : (
                        <div className="text-muted-foreground text-xs font-medium p-3 border rounded-md">
                            <Trans>No customer</Trans>
                        </div>
                    )}
                </PageBlock>
                <PageBlock column="side" blockId="addresses" title={<Trans>Addresses</Trans>}>
                    <div className="mb-4">
                        <div className="mb-1 flex items-center">
                            <Trans>Shipping address</Trans>:
                            {editingShippingAddress ? (
                                <CustomerAddressSelector
                                    customerId={entity.customer?.id}
                                    onSelect={handleSelectShippingAddress}
                                    onCancel={() => setEditingShippingAddress(false)}
                                    defaultOpen
                                />
                            ) : (
                                <Button
                                    variant="ghost"
                                    size="sm"
                                    className="ml-2"
                                    onClick={() => setEditingShippingAddress(true)}
                                >
                                    <Trans>Edit</Trans>
                                </Button>
                            )}
                        </div>
                        {shippingAddress ? (
                            <OrderAddress address={shippingAddress} />
                        ) : (
                            <div className="text-muted-foreground text-xs font-medium">
                                <Trans>No shipping address</Trans>
                            </div>
                        )}
                    </div>
                    <div>
                        <div className="mb-1 flex items-center">
                            <Trans>Billing address</Trans>:
                            {editingBillingAddress ? (
                                <CustomerAddressSelector
                                    customerId={entity.customer?.id}
                                    onSelect={handleSelectBillingAddress}
                                    onCancel={() => setEditingBillingAddress(false)}
                                    defaultOpen
                                />
                            ) : (
                                <Button
                                    variant="ghost"
                                    size="sm"
                                    className="ml-2"
                                    onClick={() => setEditingBillingAddress(true)}
                                >
                                    <Trans>Edit</Trans>
                                </Button>
                            )}
                        </div>
                        {billingAddress ? (
                            <OrderAddress address={billingAddress} />
                        ) : (
                            <div className="text-muted-foreground text-xs font-medium">
                                <Trans>No billing address</Trans>
                            </div>
                        )}
                    </div>
                </PageBlock>
            </PageLayout>
            <ManuallySelectNextState availableStates={entity.nextStates} />
        </Page>
    );
}
