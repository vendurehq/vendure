import { check } from 'k6';

import { AdminApiRequest, ShopApiRequest } from '../utils/api-request.js';
const loginMutation = new AdminApiRequest('admin/login.graphql');
const variant = __ENV.variant ? `-${__ENV.variant}` : '';
const ordersQuery = new AdminApiRequest(`admin/get-order-list${variant}.graphql`);

export let options = {
    stages: [{ duration: '1m', target: 1 }],
};

export function setup() {
    const result = loginMutation.post({ username: 'superadmin', password: 'superadmin' });
    check(result.data, {
        'logged in': data => data.login.id != null,
    });
    return { authToken: loginMutation.authToken };
}

/**
 * Performs a simple query to measure baseline request throughput
 */
export default function ({ authToken }) {
    const result = ordersQuery.post({ options: { skip: 0, take: 10 } }, authToken);
    check(result.data, {
        'fetched 10 items': data => data.orders.items.length === 10,
    });
}
