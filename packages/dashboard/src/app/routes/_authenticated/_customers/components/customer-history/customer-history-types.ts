import { ResultOf } from 'gql.tada';

import { customerHistoryDocument } from '../../customers.graphql.js';

export type CustomerHistoryCustomerDetail = NonNullable<ResultOf<typeof customerHistoryDocument>>['customer'];
