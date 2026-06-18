// @ts-check
import {check} from 'k6';
import {ShopApiRequest} from '../utils/api-request.js';

const searchQuery = new ShopApiRequest('shop/search.graphql');
const addItemToOrderMutation = new ShopApiRequest('shop/add-to-order.graphql');

export let options = {
    stages: [
        { duration: '4m', target: 1 },
    ],
};

export function setup() {
    const searchResult = searchQuery.post();
    return searchResult.data.search.items;
}

/**
 * Continuously adds random items to a single order for the duration of the test.
 */
export default function(products) {
    for (let i = 0; i < 10000; i ++) {
        addToCart(randomItem(products).productVariantId);
    }
}

function addToCart(variantId) {
    const qty = Math.ceil(Math.random() * 4);
    const result = addItemToOrderMutation.post({ id: variantId, qty });
    check(result.data, {
        'Product added to cart': r => !!r.addItemToOrder.lines
            .find(l => l.productVariant.id === variantId && l.quantity >= qty),
    });
}

function randomItem(items) {
    return items[Math.floor(Math.random() * items.length)];
}
