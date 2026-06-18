import { HistoryEntryItem } from '@/vdb/framework/extension-api/types/index.js';
import { Trans } from '@lingui/react/macro';
import {
    ArrowRightToLine,
    Ban,
    CheckIcon,
    CreditCardIcon,
    Edit3,
    RotateCcw,
    SquarePen,
    Truck,
    UserX,
} from 'lucide-react';
import { OrderHistoryOrderDetail } from './order-history-types.js';

export function orderHistoryUtils(order: OrderHistoryOrderDetail) {
    const getTimelineIcon = (entry: HistoryEntryItem) => {
        switch (entry.type) {
            case 'ORDER_PAYMENT_TRANSITION':
                return <CreditCardIcon className="h-4 w-4" />;
            case 'ORDER_REFUND_TRANSITION':
                return <CreditCardIcon className="h-4 w-4" />;
            case 'ORDER_NOTE':
                return <SquarePen className="h-4 w-4" />;
            case 'ORDER_STATE_TRANSITION':
                if (entry.data.to === 'Delivered') {
                    return <CheckIcon className="h-4 w-4" />;
                }
                if (entry.data.to === 'Cancelled') {
                    return <Ban className="h-4 w-4" />;
                }
                return <ArrowRightToLine className="h-4 w-4" />;
            case 'ORDER_FULFILLMENT_TRANSITION':
                if (entry.data.to === 'Shipped' || entry.data.to === 'Delivered') {
                    return <Truck className="h-4 w-4" />;
                }
                return <ArrowRightToLine className="h-4 w-4" />;
            case 'ORDER_FULFILLMENT':
                return <Truck className="h-4 w-4" />;
            case 'ORDER_MODIFIED':
                return <Edit3 className="h-4 w-4" />;
            case 'ORDER_CUSTOMER_UPDATED':
                return <UserX className="h-4 w-4" />;
            case 'ORDER_CANCELLATION': {
                const lines = entry.data.lines as Array<{ orderLineId: string; quantity: number }> | undefined;
                const hasRefundData = (lines && lines.length > 0) || entry.data.reason;
                if (hasRefundData) {
                    return <RotateCcw className="h-4 w-4" />;
                }
                return <Ban className="h-4 w-4" />;
            }
            default:
                return <CheckIcon className="h-4 w-4" />;
        }
    };

    const getTitle = (entry: HistoryEntryItem) => {
        switch (entry.type) {
            case 'ORDER_PAYMENT_TRANSITION':
                if (entry.data.to === 'Settled') {
                    return <Trans>Payment settled</Trans>;
                }
                if (entry.data.to === 'Authorized') {
                    return <Trans>Payment authorized</Trans>;
                }
                if (entry.data.to === 'Declined' || entry.data.to === 'Cancelled') {
                    return <Trans>Payment failed</Trans>;
                }
                return <Trans>Payment transitioned</Trans>;
            case 'ORDER_REFUND_TRANSITION':
                if (entry.data.to === 'Settled') {
                    return <Trans>Refund settled</Trans>;
                }
                return <Trans>Refund transitioned</Trans>;
            case 'ORDER_NOTE':
                return <Trans>Note added</Trans>;
            case 'ORDER_STATE_TRANSITION': {
                if (entry.data.from === 'Created') {
                    return <Trans>Order placed</Trans>;
                }
                if (entry.data.to === 'Delivered') {
                    return <Trans>Order fulfilled</Trans>;
                }
                if (entry.data.to === 'Cancelled') {
                    return <Trans>Order cancelled</Trans>;
                }
                if (entry.data.to === 'Shipped') {
                    return <Trans>Order shipped</Trans>;
                }
                return <Trans>Order transitioned</Trans>;
            }
            case 'ORDER_FULFILLMENT_TRANSITION':
                if (entry.data.to === 'Shipped') {
                    return <Trans>Order shipped</Trans>;
                }
                if (entry.data.to === 'Delivered') {
                    return <Trans>Order delivered</Trans>;
                }
                return <Trans>Fulfillment transitioned</Trans>;
            case 'ORDER_FULFILLMENT':
                return <Trans>Fulfillment created</Trans>;
            case 'ORDER_MODIFIED':
                return <Trans>Order modified</Trans>;
            case 'ORDER_CUSTOMER_UPDATED':
                return <Trans>Customer updated</Trans>;
            case 'ORDER_CANCELLATION': {
                const lines = entry.data.lines as Array<{ orderLineId: string; quantity: number }> | undefined;
                const hasPartialCancellation = lines && lines.length > 0;
                if (hasPartialCancellation || entry.data.reason) {
                    return <Trans>Items refunded</Trans>;
                }
                return <Trans>Order cancelled</Trans>;
            }
            default:
                return <Trans>{entry.type.replace(/_/g, ' ').toLowerCase()}</Trans>;
        }
    };

    const getIconColor = ({ type, data }: HistoryEntryItem) => {
        const success = 'bg-success text-success-foreground';
        const destructive = 'bg-destructive text-destructive-foreground';
        const warning = 'bg-warning text-warning-foreground';
        const regular = 'bg-muted text-muted-foreground';

        if (type === 'ORDER_PAYMENT_TRANSITION' && data.to === 'Settled') {
            return success;
        }
        if (type === 'ORDER_STATE_TRANSITION' && data.to === 'Delivered') {
            return success;
        }
        if (type === 'ORDER_FULFILLMENT_TRANSITION' && data.to === 'Delivered') {
            return success;
        }
        if (type === 'ORDER_CANCELLATION') {
            const lines = data.lines as Array<{ orderLineId: string; quantity: number }> | undefined;
            const hasRefundData = (lines && lines.length > 0) || data.reason;
            return hasRefundData ? warning : destructive;
        }
        if (type === 'ORDER_STATE_TRANSITION' && data.to === 'Cancelled') {
            return destructive;
        }
        if (type === 'ORDER_PAYMENT_TRANSITION' && (data.to === 'Declined' || data.to === 'Cancelled')) {
            return destructive;
        }
        return regular;
    };

    const getActorName = (entry: HistoryEntryItem) => {
        if (entry.administrator) {
            return `${entry.administrator.firstName} ${entry.administrator.lastName}`;
        } else if (order?.customer) {
            return `${order.customer.firstName} ${order.customer.lastName}`;
        }
        return '';
    };

    const isPrimaryEvent = (entry: HistoryEntryItem) => {
        switch (entry.type) {
            case 'ORDER_STATE_TRANSITION':
                return (
                    entry.data.to === 'Delivered' ||
                    entry.data.to === 'Cancelled' ||
                    entry.data.to === 'Settled' ||
                    entry.data.from === 'Created'
                );
            case 'ORDER_REFUND_TRANSITION':
                return entry.data.to === 'Settled';
            case 'ORDER_PAYMENT_TRANSITION':
                return entry.data.to === 'Settled' || entry.data.to === 'Cancelled';
            case 'ORDER_FULFILLMENT_TRANSITION':
                return entry.data.to === 'Delivered' || entry.data.to === 'Shipped';
            case 'ORDER_NOTE':
            case 'ORDER_MODIFIED':
            case 'ORDER_CUSTOMER_UPDATED':
            case 'ORDER_CANCELLATION':
                return true;
            default:
                return false; // All other events are secondary
        }
    };

    return {
        getTimelineIcon,
        getTitle,
        getIconColor,
        getActorName,
        isPrimaryEvent,
    };
}
