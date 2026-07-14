import { CustomFieldsForm } from '@/vdb/components/shared/custom-fields-form.js';
import { PermissionGuard } from '@/vdb/components/shared/permission-guard.js';
import { Button } from '@/vdb/components/ui/button.js';
import { DropdownMenuItem } from '@/vdb/components/ui/dropdown-menu.js';
import { addCustomFields } from '@/vdb/framework/document-introspection/add-custom-fields.js';
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
import { useCustomFieldConfig } from '@/vdb/hooks/use-custom-field-config.js';
import { useDynamicTranslations } from '@/vdb/hooks/use-dynamic-translations.js';
import { Trans, useLingui } from '@lingui/react/macro';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Link, useNavigate } from '@tanstack/react-router';
import { ResultOf } from 'gql.tada';
import { Pencil, RotateCcw, User } from 'lucide-react';
import { useCallback, useMemo, useRef } from 'react';
import { toast } from 'sonner';

import {
    orderDetailDocument,
    setOrderCustomFieldsDocument,
    transitionOrderToStateDocument,
} from '../orders.graphql.js';
import { OrderProcessDialog } from './order-process-dialog.js';
import { canAddFulfillment, canRefundOrder, shouldShowAddManualPaymentButton } from '../utils/order-utils.js';

import { AddManualPaymentDialog } from './add-manual-payment-dialog.js';
import { FulfillOrderDialog } from './fulfill-order-dialog.js';
import { FulfillmentDetails } from './fulfillment-details.js';
import { OrderAddress } from './order-address.js';
import { OrderHistoryContainer } from './order-history/order-history-container.js';
import { orderHistoryQueryKey } from './order-history/use-order-history.js';
import { OrderTable } from './order-table.js';
import { OrderTaxSummary } from './order-tax-summary.js';
import { PaymentDetails } from './payment-details.js';
import { RefundOrderDialog, RefundOrderDialogRef } from './refund-order-dialog.js';
import { getTypeForState, StateTransitionControl } from './state-transition-control.js';
import { useTransitionOrderToState } from './use-transition-order-to-state.js';

export type OrderDetail = NonNullable<ResultOf<typeof orderDetailDocument>['order']>;

export interface OrderDetailSharedProps {
    // Required props
    pageId: string;
    orderId: string;
    // Title customization
    titleSlot?: (order: OrderDetail) => React.ReactNode;
    // Optional content slots
    beforeOrderTable?: (order: OrderDetail) => React.ReactNode;
}

function DefaultOrderTitle({ entity }: { entity: any }) {
    return <>{entity?.code ?? ''}</>;
}

/**
 * @description
 * Shared functionality between the order and seller order detail pages.
 */
export function OrderDetailShared({
    pageId,
    orderId,
    titleSlot,
    beforeOrderTable,
}: Readonly<OrderDetailSharedProps>) {
    const { t } = useLingui();
    const navigate = useNavigate();
    const queryClient = useQueryClient();
    const { getTranslatedOrderState } = useDynamicTranslations();

    const { form, submitHandler, entity, refreshEntity } = useDetailPage({
        pageId,
        queryDocument: addCustomFields(orderDetailDocument, {
            includeNestedFragments: ['OrderLine', 'Fulfillment'],
        }),
        updateDocument: setOrderCustomFieldsDocument,
        setValuesForUpdate: (entity: any) => {
            return {
                id: entity.id,
                customFields: entity.customFields,
            };
        },
        params: { id: orderId },
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

    const { transitionToState } = useTransitionOrderToState(entity?.id);
    const transitionOrderToStateMutation = useMutation({
        mutationFn: api.mutate(transitionOrderToStateDocument),
    });

    const customFieldConfig = useCustomFieldConfig('Order');
    const refundDialogRef = useRef<RefundOrderDialogRef>(null);

    const refreshPage = useCallback(async () => {
        if (!entity) return;
        await Promise.all([
            refreshEntity(),
            queryClient.refetchQueries({ queryKey: orderHistoryQueryKey(entity.id) }),
        ]);
    }, [refreshEntity, entity, queryClient]);

    const stateTransitionActions = useMemo(() => {
        if (!entity) {
            return [];
        }
        return entity.nextStates
            .filter((state: string) => state !== 'Modifying')
            .map((state: string) => ({
                label: t`Transition to ${getTranslatedOrderState(state)}`,
                type: getTypeForState(state),
                onClick: async () => {
                    const transitionError = await transitionToState(state);
                    if (transitionError) {
                        toast(t`Failed to transition order to state`, {
                            description: transitionError,
                        });
                    } else {
                        void refreshPage();
                    }
                },
            }));
    }, [entity, transitionToState, t, refreshPage]);

    const handleModifyClick = useCallback(async () => {
        if (!entity) return;
        try {
            await transitionOrderToStateMutation.mutateAsync({
                id: entity.id,
                state: 'Modifying',
            });
            await refreshPage();
            await navigate({ to: `/orders/$id/modify`, params: { id: entity.id } });
        } catch (error) {
            toast(t`Failed to modify order`, {
                description: error instanceof Error ? error.message : 'Unknown error',
            });
        }
    }, [entity, transitionOrderToStateMutation, refreshPage, navigate, t]);

    const ModifyMenuItem = useCallback(
        () => (
            <DropdownMenuItem onClick={handleModifyClick}>
                <Pencil className="w-4 h-4" />
                <Trans>Modify</Trans>
            </DropdownMenuItem>
        ),
        [handleModifyClick],
    );

    const RefundMenuItem = useCallback(
        () => (
            <PermissionGuard requires={['UpdateOrder']}>
                <DropdownMenuItem onClick={() => refundDialogRef.current?.open()}>
                    <RotateCcw className="w-4 h-4" />
                    <Trans>Refund & Cancel</Trans>
                </DropdownMenuItem>
            </PermissionGuard>
        ),
        [],
    );

    if (!entity) {
        return null;
    }

    const nextStates = entity.nextStates;
    const showAddPaymentButton = shouldShowAddManualPaymentButton(entity);
    const showFulfillButton = canAddFulfillment(entity);
    const showRefundOption = canRefundOrder(entity);

    return (
        <Page pageId={pageId} form={form} submitHandler={submitHandler} entity={entity}>
            <PageTitle>{titleSlot?.(entity) || <DefaultOrderTitle entity={entity} />}</PageTitle>
            <PageActionBar
                    dropdownMenuItems={[
                        ...(nextStates.includes('Modifying') ? [{ component: ModifyMenuItem }] : []),
                        ...(showRefundOption ? [{ component: RefundMenuItem }] : []),
                    ]}
                >
                {showAddPaymentButton && (
                    <ActionBarItem itemId="add-payment-button" requiresPermission={['UpdateOrder']}>
                        <AddManualPaymentDialog
                            order={entity}
                            onSuccess={() => {
                                refreshEntity();
                            }}
                        />
                    </ActionBarItem>
                )}
                {showFulfillButton && (
                    <ActionBarItem itemId="fulfill-order-button" requiresPermission={['UpdateOrder']}>
                        <FulfillOrderDialog
                            order={entity}
                            onSuccess={() => {
                                void refreshPage();
                            }}
                        />
                    </ActionBarItem>
                )}
                {showRefundOption && (
                    <RefundOrderDialog
                        ref={refundDialogRef}
                        order={entity}
                        onSuccess={() => {
                            void refreshPage();
                        }}
                    />
                )}
            </PageActionBar>
            <PageLayout>
                {/* Main Column Blocks */}
                {beforeOrderTable?.(entity)}
                <PageBlock column="main" blockId="order-table">
                    <OrderTable order={entity} pageId={pageId} />
                </PageBlock>
                <PageBlock column="main" blockId="tax-summary" title={<Trans>Tax summary</Trans>}>
                    <OrderTaxSummary order={entity} />
                </PageBlock>
                {customFieldConfig?.length ? (
                    <PageBlock column="main" blockId="custom-fields">
                        <CustomFieldsForm entityType="Order" control={form.control} />
                        <div className="flex justify-end">
                            <Button
                                type="submit"
                                disabled={!form.formState.isDirty || !form.formState.isValid}
                            >
                                <Trans>Save</Trans>
                            </Button>
                        </div>
                    </PageBlock>
                ) : null}
                <PageBlock column="main" blockId="payment-details" title={<Trans>Payment details</Trans>}>
                    <div className="grid lg:grid-cols-2 gap-4">
                        {entity?.payments?.map((payment: any) => (
                            <PaymentDetails
                                key={payment.id}
                                payment={payment}
                                currencyCode={entity.currencyCode}
                                onSuccess={refreshPage}
                            />
                        ))}
                    </div>
                </PageBlock>
                <PageBlock column="main" blockId="order-history" title={<Trans>Order history</Trans>}>
                    <OrderHistoryContainer orderId={orderId} />
                </PageBlock>

                {/* Side Column Blocks */}
                <PageBlock column="side" blockId="state">
                    <div className="flex items-center gap-1.5">
                        <StateTransitionControl
                            currentState={entity?.state}
                            statesTranslationFunction={getTranslatedOrderState}
                            actions={stateTransitionActions}
                            isLoading={transitionOrderToStateMutation.isPending}
                        />
                        <OrderProcessDialog currentState={entity!.state} />
                    </div>
                </PageBlock>
                <PageBlock column="side" blockId="customer" title={<Trans>Customer</Trans>}>
                    {entity?.customer ? (
                        <Button variant="outline" render={<Link to={`/customers/${entity.customer.id}`} />}>
                            <User className="w-4 h-4" />
                            {entity.customer.firstName} {entity.customer.lastName}
                        </Button>
                    ) : (
                        <div className="text-muted-foreground text-xs font-medium p-3 border rounded-md">
                            <Trans>No customer</Trans>
                        </div>
                    )}
                    <div className="mt-4 divide-y">
                        {entity?.shippingAddress && (
                            <div className="pb-6">
                                <div className="font-medium mb-6">
                                    <Trans>Shipping address</Trans>
                                </div>
                                <OrderAddress address={entity.shippingAddress} />
                            </div>
                        )}
                        {entity?.billingAddress && (
                            <div className="pt-4">
                                <div className="font-medium mb-6">
                                    <Trans>Billing address</Trans>
                                </div>
                                <OrderAddress address={entity.billingAddress} />
                            </div>
                        )}
                    </div>
                </PageBlock>
                <PageBlock
                    column="side"
                    blockId="fulfillment-details"
                    title={<Trans>Fulfillment details</Trans>}
                >
                    {entity?.fulfillments?.length && entity.fulfillments.length > 0 ? (
                        <div className="space-y-2">
                            {entity?.fulfillments?.map((fulfillment: any) => (
                                <FulfillmentDetails
                                    key={fulfillment.id}
                                    order={entity}
                                    fulfillment={fulfillment}
                                    onSuccess={() => {
                                        void refreshPage();
                                    }}
                                />
                            ))}
                        </div>
                    ) : (
                        <div className="text-muted-foreground text-sm">
                            <Trans>No fulfillments</Trans>
                        </div>
                    )}
                </PageBlock>
            </PageLayout>
        </Page>
    );
}
