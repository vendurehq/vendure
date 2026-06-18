import { check } from 'k6';

import { AdminApiRequest, ShopApiRequest } from '../utils/api-request.js';
const loginMutation = new AdminApiRequest('admin/login.graphql');
const productsQuery = new AdminApiRequest('admin/get-product-list.graphql');

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
    const result = productsQuery.post({ options: { skip: 0, take: 10 } }, authToken);
    check(result.data, {
        'fetched 10 items': data => data.products.items.length === 10,
    });
}
