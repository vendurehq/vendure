import { graphql } from '@/vdb/graphql/graphql.js';

export const stockLocationFragment = graphql(`
    fragment StockLocationItem on StockLocation {
        id
        createdAt
        updatedAt
        name
        description
    }
`);

export const stockLocationListQuery = graphql(
    `
        query StockLocationList($options: StockLocationListOptions) {
            stockLocations(options: $options) {
                items {
                    ...StockLocationItem
                }
                totalItems
            }
        }
    `,
    [stockLocationFragment],
);

export const stockLocationDetailQuery = graphql(
    `
        query StockLocationDetail($id: ID!) {
            stockLocation(id: $id) {
                ...StockLocationItem
                customFields
            }
        }
    `,
    [stockLocationFragment],
);

export const createStockLocationDocument = graphql(`
    mutation CreateStockLocation($input: CreateStockLocationInput!) {
        createStockLocation(input: $input) {
            id
        }
    }
`);

export const updateStockLocationDocument = graphql(`
    mutation UpdateStockLocation($input: UpdateStockLocationInput!) {
        updateStockLocation(input: $input) {
            id
        }
    }
`);

export const deleteStockLocationDocument = graphql(`
    mutation DeleteStockLocation($id: ID!) {
        deleteStockLocation(input: { id: $id }) {
            result
            message
        }
    }
`);

export const deleteStockLocationsDocument = graphql(`
    mutation DeleteStockLocations($input: [DeleteStockLocationInput!]!) {
        deleteStockLocations(input: $input) {
            result
            message
        }
    }
`);

export const assignStockLocationsToChannelDocument = graphql(`
    mutation AssignStockLocationsToChannel($input: AssignStockLocationsToChannelInput!) {
        assignStockLocationsToChannel(input: $input) {
            id
        }
    }
`);

export const removeStockLocationsFromChannelDocument = graphql(`
    mutation RemoveStockLocationsFromChannel($input: RemoveStockLocationsFromChannelInput!) {
        removeStockLocationsFromChannel(input: $input) {
            id
        }
    }
`);
