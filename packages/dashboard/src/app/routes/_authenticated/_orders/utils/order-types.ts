import { FragmentOf, ResultOf } from '@/vdb/graphql/graphql.js';

import { addressFragment } from '../../_customers/customers.graphql.js';
import { orderAddressFragment, orderDetailDocument } from '../orders.graphql.js';

export type Order = NonNullable<ResultOf<typeof orderDetailDocument>['order']>;
export type Payment = NonNullable<NonNullable<Order>['payments']>[number];
export type Fulfillment = NonNullable<NonNullable<Order>['fulfillments']>[number];
export type OrderAddressFragment = FragmentOf<typeof orderAddressFragment>;
export type AddressFragment = FragmentOf<typeof addressFragment>;
