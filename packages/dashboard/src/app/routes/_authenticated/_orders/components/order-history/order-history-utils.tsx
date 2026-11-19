import type { Tone } from '@/vdb/components/ui/status-badge.js';
import { HistoryEntryItem } from '@/vdb/framework/extension-api/types/index.js';
import { orderStateDictionary } from '@/vdb/utils/state-type.js';
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
                return <CreditCardIcon />;
            case 'ORDER_REFUND_TRANSITION':
                return <CreditCardIcon />;
            case 'ORDER_NOTE':
                return <SquarePen />;
            case 'ORDER_STATE_TRANSITION':
                if (entry.data.to === 'Delivered') {
                    return <CheckIcon />;
                }
                if (entry.data.to === 'Cancelled') {
                    return <Ban />;
                }
                return <ArrowRightToLine />;
            case 'ORDER_FULFILLMENT_TRANSITION':
                if (entry.data.to === 'Shipped' || entry.data.to === 'Delivered') {
                    return <Truck />;
                }
                return <ArrowRightToLine />;
            case 'ORDER_FULFILLMENT':
                return <Truck />;
            case 'ORDER_MODIFIED':
                return <Edit3 />;
            case 'ORDER_CUSTOMER_UPDATED':
                return <UserX />;
            case 'ORDER_CANCELLATION': {
                const lines = entry.data.lines as Array<{ orderLineId: string; quantity: number }> | undefined;
                const hasRefundData = (lines && lines.length > 0) || entry.data.reason;
                if (hasRefundData) {
                    return <RotateCcw />;
                }
                return <Ban />;
            }
            default:
                return <CheckIcon />;
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

    /**
     * The marker tone of an entry: the tone of the state it moved to, from the
     * order state dictionary. A cancellation takes the tone of `Cancelled`.
     * Every other entry stays neutral.
     */
    const getTone = ({ type, data }: HistoryEntryItem): Tone => {
        switch (type) {
            case 'ORDER_STATE_TRANSITION':
            case 'ORDER_PAYMENT_TRANSITION':
            case 'ORDER_REFUND_TRANSITION':
            case 'ORDER_FULFILLMENT_TRANSITION':
                return typeof data.to === 'string' ? orderStateDictionary.toneFor(data.to) : 'neutral';
            case 'ORDER_CANCELLATION':
                return orderStateDictionary.toneFor('Cancelled');
            default:
                return 'neutral';
        }
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
        getTone,
        getActorName,
        isPrimaryEvent,
    };
}
