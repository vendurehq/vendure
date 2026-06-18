import { ShopApiRequest } from '../utils/api-request.js';

const deepQuery = new ShopApiRequest('shop/deep-query.graphql');

export let options = {
    stages: [
        { duration: '1m', target: 500 },
    ],
};

/**
 * Performs a single deeply-nested GraphQL query
 */
export default function() {
    deepQuery.post();
}
