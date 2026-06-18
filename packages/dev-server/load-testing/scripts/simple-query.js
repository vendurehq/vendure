import { ShopApiRequest } from '../utils/api-request.js';

const simpleQuery = new ShopApiRequest('shop/simple-product-query.graphql');

export let options = {
    stages: [{ duration: '1m', target: 1 }],
};

/**
 * Performs a simple query to measure baseline request throughput
 */
export default function () {
    simpleQuery.post();
}
