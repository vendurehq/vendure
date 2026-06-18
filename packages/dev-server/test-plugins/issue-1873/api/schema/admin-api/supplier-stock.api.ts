import gql from 'graphql-tag';

export const supplierStockApi = gql`
  extend type Query {
    "Query all supplierStock list"
    supplierStocks(options: SupplierStockListOptions): SupplierStockList!
  }

  extend type Mutation {
    initializeDemo: Boolean
  }

  input SupplierStockListOptions
`;
