import { graphql } from '@/vdb/graphql/graphql.js';

export const facetValueFragment = graphql(`
    fragment FacetValue on FacetValue {
        id
        createdAt
        updatedAt
        languageCode
        code
        name
        translations {
            id
            languageCode
            name
        }
        facet {
            id
            createdAt
            updatedAt
            name
            code
        }
    }
`);

export const facetWithValuesFragment = graphql(
    `
        fragment FacetWithValueList on Facet {
            id
            createdAt
            updatedAt
            name
            code
            isPrivate
            valueList(options: $facetValueListOptions) {
                totalItems
                items {
                    ...FacetValue
                }
            }
        }
    `,
    [facetValueFragment],
);

export const facetListDocument = graphql(
    `
        query FacetList($options: FacetListOptions, $facetValueListOptions: FacetValueListOptions) {
            facets(options: $options) {
                items {
                    ...FacetWithValueList
                }
                totalItems
            }
        }
    `,
    [facetWithValuesFragment],
);

export const facetDetailDocument = graphql(`
    query FacetDetail($id: ID!) {
        facet(id: $id) {
            id
            createdAt
            updatedAt
            name
            code
            languageCode
            isPrivate
            translations {
                id
                languageCode
                name
            }
            customFields
        }
    }
`);

export const createFacetDocument = graphql(`
    mutation CreateFacet($input: CreateFacetInput!) {
        createFacet(input: $input) {
            id
        }
    }
`);

export const updateFacetDocument = graphql(`
    mutation UpdateFacet($input: UpdateFacetInput!) {
        updateFacet(input: $input) {
            id
        }
    }
`);

export const deleteFacetDocument = graphql(`
    mutation DeleteFacet($id: ID!) {
        deleteFacet(id: $id) {
            result
            message
        }
    }
`);

export const assignFacetsToChannelDocument = graphql(`
    mutation AssignFacetsToChannel($input: AssignFacetsToChannelInput!) {
        assignFacetsToChannel(input: $input) {
            id
        }
    }
`);

export const removeFacetsFromChannelDocument = graphql(`
    mutation RemoveFacetsFromChannel($input: RemoveFacetsFromChannelInput!) {
        removeFacetsFromChannel(input: $input) {
            ... on Facet {
                id
            }
            ... on ErrorResult {
                message
            }
        }
    }
`);

export const deleteFacetsDocument = graphql(`
    mutation DeleteFacets($ids: [ID!]!) {
        deleteFacets(ids: $ids) {
            result
            message
        }
    }
`);

export const deleteFacetValuesDocument = graphql(`
    mutation DeleteFacetValues($ids: [ID!]!) {
        deleteFacetValues(ids: $ids) {
            result
            message
        }
    }
`);

export const facetValueDetailDocument = graphql(`
    query FacetValueDetail($id: ID!) {
        facetValue(id: $id) {
            id
            createdAt
            updatedAt
            name
            code
            languageCode
            translations {
                id
                languageCode
                name
            }
            facet {
                id
                name
                code
            }
            customFields
        }
    }
`);

export const createFacetValueDocument = graphql(`
    mutation CreateFacetValue($input: CreateFacetValueInput!) {
        createFacetValue(input: $input) {
            id
        }
    }
`);

export const updateFacetValueDocument = graphql(`
    mutation UpdateFacetValue($input: UpdateFacetValueInput!) {
        updateFacetValue(input: $input) {
            id
        }
    }
`);
