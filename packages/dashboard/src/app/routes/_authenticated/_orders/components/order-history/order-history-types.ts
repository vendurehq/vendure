import { ResultOf } from 'gql.tada';

import { orderHistoryDocument } from '../../orders.graphql.js';

export type OrderHistoryOrderDetail = NonNullable<ResultOf<typeof orderHistoryDocument>>['order'];
