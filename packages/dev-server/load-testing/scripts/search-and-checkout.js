// @ts-check
import { sleep } from 'k6';
import { check } from 'k6';
import { ShopApiRequest } from '../utils/api-request.js';

const searchQuery = new ShopApiRequest('shop/search.graphql');
const productQuery = new ShopApiRequest('shop/product.graphql');
const addItemToOrderMutation = new ShopApiRequest('shop/add-to-order.graphql');
const setShippingAddressMutation = new ShopApiRequest('shop/set-shipping-address.graphql');
const getShippingMethodsQuery = new ShopApiRequest('shop/get-shipping-methods.graphql');
const completeOrderMutation = new ShopApiRequest('shop/complete-order.graphql');

export let options = {
    stages: [{ duration: '4m', target: 50 }],
};

/**
 * Searches for products, adds to order, checks out.
 */
export default function () {
    const itemsToAdd = Math.ceil(Math.random() * 10);

    for (let i = 0; i < itemsToAdd; i++) {
        searchProducts();
        const product = findAndLoadProduct();
        addToCart(randomItem(product.variants).id);
    }
    setShippingAddressAndCustomer();
    const { data: shippingMethods } = getShippingMethodsQuery.post();
    const { data: order } = completeOrderMutation.post({
        id: [shippingMethods.eligibleShippingMethods.at(0).id],
    });
    check(order, {
        'Order completed': o => o.addPaymentToOrder.state === 'PaymentAuthorized',
    });
}

function searchProducts() {
    for (let i = 0; i < 4; i++) {
        searchQuery.post();
        sleep(Math.random() * 3 + 0.5);
    }
}

function findAndLoadProduct() {
    const searchResult = searchQuery.post();
    const items = searchResult.data.search.items;
    const productResult = productQuery.post({ id: randomItem(items).productId });
    return productResult.data.product;
}

function addToCart(variantId) {
    const qty = Math.ceil(Math.random() * 4);
    const result = addItemToOrderMutation.post({ id: variantId, qty });
    check(result.data, {
        'Product added to cart': r =>
            !!r.addItemToOrder.lines.find(l => l.productVariant.id === variantId && l.quantity >= qty),
    });
}

function setShippingAddressAndCustomer() {
    const result = setShippingAddressMutation.post({
        address: {
            countryCode: 'GB',
            streetLine1: '123 Test Street',
        },
        customer: {
            emailAddress: `test-user-${Math.random().toString(32).substr(3)}@mail.com`,
            firstName: `Test`,
            lastName: `User`,
        },
    });
    check(result.data, {
        'Address set': r => r.setOrderShippingAddress.shippingAddress.country === 'United Kingdom',
    });
}

function randomItem(items) {
    return items[Math.floor(Math.random() * items.length)];
}
