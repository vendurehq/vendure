# Reviews Plugin

The reviews plugin add product reviews to Vendure.

This plugin demonstrates many capabilities of the Vendure plugin system:

* Creation of new database entities (see [./entities](./entities))
* Extension of the GraphQL APIs with new types, extensions of existing types, new queries and new mutations (see [./api/api-extensions.ts](api/api-extensions.ts))
* Implementation of custom resolvers for those GraphQL extensions (e.g. [./api/product-entity.resolver.ts](api/product-entity.resolver.ts))
* Modifying the VendureConfig to add CustomFields (see [./reviews-plugin.ts](./reviews-plugin.ts))
* Extending the Dashboard with custom form components for those CustomFields as well as list and detail views for managing reviews (see [./dashboard](./dashboard)).
* Adding a custom widget to the Dashboard
* End-to-end testing of the GraphQL extensions & business logic with Vitest & the `@vendure/testing` package.

## Usage

Start the Vendure server and then in the Shop API (http://localhost:3000/shop-api) try the following mutation:

```SDL
mutation {
  submitProductReview(input: {
    productId: 2
    summary: "Good tablet"
    body: "The screen is clear, bright and sharp!"
    rating: 5
    authorName: "Joe Smith"
    authorLocation: "London"
  }) {
    id
    state
  }
}
```

You should then be able to log into the Dashboard and see the new "Product Reviews" menu item. This takes you to a list of all product reviews, where you can approve the review that was just submitted.
