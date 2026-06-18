# Example multi-vendor marketplace plugin

This is an example plugin which demonstrates how to build a multi-vendor marketplace with Vendure. It uses new APIs and features introduced in Vendure v2.0.

The parts of the plugin are documented with explanations, and the overall guide can be found in the [Multi-vendor marketplace](https://docs.vendure.io/guides/how-to/multi-vendor-marketplaces/) section of the Vendure docs.

## Setup

Add this plugin to your VendureConfig:
```ts
import { MultivendorPlugin } from './plugins/multivendor-plugin/multivendor.plugin';

 plugins: [
   MultivendorPlugin.init({
       platformFeePercent: 10,
       platformFeeSKU: 'FEE',
   }),
   // ...
 ]
```

## Create a Seller

Now you can create new sellers with the following mutation in the Shop API:

```graphql
mutation RegisterSeller {
  registerNewSeller(input: {
    shopName: "Bob's Parts",
    seller: {
      firstName: "Bob"
      lastName: "Dobalina"
      emailAddress: "bob@bobs-parts.com"
      password: "test",
    }
  }) {
    id
    code
    token
  }
}
```

This mutation will:

- Create a new Seller representing the shop "Bob's Parts"
- Create a new Channel and associate it with the new Seller
- Create a Role & Administrator for Bob to access his shop admin account
- Create a ShippingMethod for Bob's shop
- Create a StockLocation for Bob's shop

Bob can then go and sign in to the Admin UI using the provided emailAddress & password credentials, and start
creating some products.

Repeat this process for more Sellers.

## Storefront

To create a multivendor Order, use the default Channel in the storefront and add variants to an Order from
various Sellers.

### Shipping

When it comes to setting the shipping method, the `eligibleShippingMethods` query should just return the
shipping methods for the shops from which the OrderLines come. So assuming the Order contains items from 3 different
Sellers, there should be at least 3 eligible ShippingMethods (plus any global ones from the default Channel).

You should now select the IDs of all the Seller-specific ShippingMethods:

```graphql
mutation {
  setOrderShippingMethod(shippingMethodId: ["3", "4"]) {
    ... on Order {
      id
    }
  }
}
```

### Payment

This plugin automatically creates a "connected payment method" in the default Channel, which is a simple simulation
of something like Stripe Connect.

```graphql
mutation {
  addPaymentToOrder(input: { method: "connected-payment-method", metadata: {} }) {
    ... on Order { id }
    ... on ErrorResult {
      errorCode
      message
    }
    ... on PaymentFailedError {
      paymentErrorMessage
    }
  }
}
```

After that, you should be able to see that the Order has been split into an "aggregate" order in the default Channel,
and then one or more "seller" orders in each Channel from which the customer bought items.
