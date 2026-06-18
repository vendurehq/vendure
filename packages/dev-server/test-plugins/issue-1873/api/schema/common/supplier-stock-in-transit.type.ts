import gql from 'graphql-tag';

export const supplierStockInTransitType = gql`
  type SupplierStockInTransit implements Node {
    id: ID!
    quantity: Int!
    channelName: String
    channelOrderNo: String!
    supplierStock: SupplierStock!
    supplierStockId: ID!
  }

  type SupplierStockInTransitList implements PaginatedList {
    items: [SupplierStockInTransit!]!
    totalItems: Int!
  }
`;
