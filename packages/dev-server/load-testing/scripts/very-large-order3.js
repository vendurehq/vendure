// @ts-check
import { check } from 'k6';
import { ShopApiRequest } from '../utils/api-request.js';

const searchQuery = new ShopApiRequest('shop/search.graphql');
const addItemToOrderMutation = new ShopApiRequest('shop/add-to-order.graphql');
const adjustOrderLineMutation = new ShopApiRequest('shop/adjust-order-line.graphql');

export let options = {
    stages: [{ duration: '1m', target: 1 }],
};

export function setup() {
    const searchResult = searchQuery.post();
    const items = searchResult.data.search.items;
    return items;
}

/**
 * Continuously adds random items to a single order for the duration of the test.
 * Just like very-large-order.js but adds 999 items each time, and runs for only 1 minute.
 * Both addItemToOrder and adjustOrderLine are tested as the latter needs the first and tends to be more complex/slower.
 */
export default function (products) {
    const orderLineId = addToCart(randomItem(products).productVariantId, 999);
    adjustOrderLine(orderLineId, 1);
    adjustOrderLine(orderLineId, 999);
    adjustOrderLine(orderLineId, 0);
}

function addToCart(variantId, qty) {
    const result = addItemToOrderMutation.post({ id: variantId, qty });
    check(result.data, {
        'Product added to cart': r =>
            !!r.addItemToOrder.lines.find(l => l.productVariant.id === variantId && l.quantity === qty),
    });
    return result.data.addItemToOrder.lines.find(l => l.productVariant.id === variantId).id;
}

function adjustOrderLine(orderLineId, qty) {
    const result = adjustOrderLineMutation.post({ id: orderLineId, qty });
    check(result.data, {
        'Product quantity adjusted': r => r.adjustOrderLine.totalQuantity === qty,
    });
}

function randomItem(items) {
    return items[Math.floor(Math.random() * items.length)];
}
