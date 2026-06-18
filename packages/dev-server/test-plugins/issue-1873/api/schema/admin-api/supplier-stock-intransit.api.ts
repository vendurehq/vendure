import gql from 'graphql-tag';

export const supplierStockInTransitApi = gql`
  extend type Query {
    "Query all SupplierStockInTransit list"
    supplierStockInTransits(
      options: SupplierStockInTransitListOptions
    ): SupplierStockInTransitList!
  }
  input SupplierStockInTransitListOptions
`;
