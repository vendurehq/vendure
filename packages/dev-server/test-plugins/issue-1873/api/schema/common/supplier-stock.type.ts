import gql from 'graphql-tag';

export const supplierStockType = gql`
  type SupplierStock implements Node {
    id: ID!
    createdAt: DateTime!
    updatedAt: DateTime!
    stockOnHand: Int!
    virtualStock: Int!
    inTransitsStock: Int!
    stockArea: String
    productVariant: ProductVariant!
    productVariantId: ID!
    product: Product!
    productId: ID!
    comment: String
    enabled: Boolean!
    link: String
    tags: [String!]
  }

  type SupplierStockList implements PaginatedList {
    items: [SupplierStock!]!
    totalItems: Int!
  }
`;
