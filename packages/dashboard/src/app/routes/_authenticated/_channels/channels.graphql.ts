import { graphql } from '@/vdb/graphql/graphql.js';

export const channelItemFragment = graphql(`
    fragment ChannelItem on Channel {
        id
        createdAt
        updatedAt
        code
        token
        pricesIncludeTax
        availableCurrencyCodes
        availableLanguageCodes
        defaultCurrencyCode
        defaultLanguageCode
        defaultShippingZone {
            id
            name
        }
        defaultTaxZone {
            id
            name
        }
        seller {
            id
            name
        }
    }
`);

export const channelListQuery = graphql(
    `
        query ChannelList($options: ChannelListOptions) {
            channels(options: $options) {
                items {
                    ...ChannelItem
                }
                totalItems
            }
        }
    `,
    [channelItemFragment],
);

export const channelDetailDocument = graphql(
    `
        query ChannelDetail($id: ID!) {
            channel(id: $id) {
                ...ChannelItem
                customFields
            }
        }
    `,
    [channelItemFragment],
);

export const createChannelDocument = graphql(`
    mutation CreateChannel($input: CreateChannelInput!) {
        createChannel(input: $input) {
            __typename
            ... on Channel {
                id
            }
            ... on ErrorResult {
                errorCode
                message
            }
        }
    }
`);

export const updateChannelDocument = graphql(`
    mutation UpdateChannel($input: UpdateChannelInput!) {
        updateChannel(input: $input) {
            __typename
            ... on Channel {
                id
            }
            ... on ErrorResult {
                errorCode
                message
            }
        }
    }
`);

export const deleteChannelDocument = graphql(`
    mutation DeleteChannel($id: ID!) {
        deleteChannel(id: $id) {
            result
            message
        }
    }
`);

export const deleteChannelsDocument = graphql(`
    mutation DeleteChannels($ids: [ID!]!) {
        deleteChannels(ids: $ids) {
            result
            message
        }
    }
`);
