import gql from 'graphql-tag';
import {
  supplierStockType,
  supplierStockInTransitType,
  supplierStockCommonType,
} from '../common';
import { supplierStockInTransitApi } from './supplier-stock-intransit.api';
import { supplierStockApi } from './supplier-stock.api';

export const adminApiExtensions = gql`
  ${supplierStockType}
  ${supplierStockInTransitType}
  ${supplierStockCommonType}

  ${supplierStockApi}
  ${supplierStockInTransitApi}
`;
