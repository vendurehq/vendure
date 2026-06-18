import { graphql } from '@/vdb/graphql/graphql.js';

export const zoneItemFragment = graphql(`
    fragment ZoneItem on Zone {
        id
        createdAt
        updatedAt
        name
    }
`);

export const zoneListQuery = graphql(
    `
        query ZoneList($options: ZoneListOptions) {
            zones(options: $options) {
                items {
                    ...ZoneItem
                }
                totalItems
            }
        }
    `,
    [zoneItemFragment],
);

export const zoneMembersQuery = graphql(`
    query ZoneMembers($zoneId: ID!) {
        zone(id: $zoneId) {
            id
            createdAt
            updatedAt
            name
            members {
                createdAt
                updatedAt
                id
                name
                code
                enabled
            }
        }
    }
`);

export const zoneDetailDocument = graphql(
    `
        query ZoneDetail($id: ID!) {
            zone(id: $id) {
                ...ZoneItem
                customFields
            }
        }
    `,
    [zoneItemFragment],
);

export const createZoneDocument = graphql(`
    mutation CreateZone($input: CreateZoneInput!) {
        createZone(input: $input) {
            id
        }
    }
`);

export const updateZoneDocument = graphql(`
    mutation UpdateZone($input: UpdateZoneInput!) {
        updateZone(input: $input) {
            id
        }
    }
`);

export const addCountryToZoneMutation = graphql(`
    mutation AddMembersToZone($zoneId: ID!, $memberIds: [ID!]!) {
        addMembersToZone(zoneId: $zoneId, memberIds: $memberIds) {
            id
        }
    }
`);

export const removeCountryFromZoneMutation = graphql(`
    mutation RemoveMembersFromZone($zoneId: ID!, $memberIds: [ID!]!) {
        removeMembersFromZone(zoneId: $zoneId, memberIds: $memberIds) {
            id
        }
    }
`);

export const deleteZoneDocument = graphql(`
    mutation DeleteZone($id: ID!) {
        deleteZone(id: $id) {
            result
            message
        }
    }
`);

export const deleteZonesDocument = graphql(`
    mutation DeleteZones($ids: [ID!]!) {
        deleteZones(ids: $ids) {
            result
            message
        }
    }
`);
