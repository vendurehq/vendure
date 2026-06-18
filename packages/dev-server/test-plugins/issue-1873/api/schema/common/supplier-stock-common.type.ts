import gql from 'graphql-tag';

export const supplierStockCommonType = gql`
  enum SupplierStockAdjustType {
    STOCK_REAL
    STOCK_VIRTUAL
    STOCK_BOTH
    STOCK_IN_TRANSIT
    STOCK_TRANSIT_TO_STOCK
    NONE
  }
`;
