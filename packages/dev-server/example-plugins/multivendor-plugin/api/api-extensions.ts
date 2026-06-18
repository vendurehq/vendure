import gql from 'graphql-tag';

export const shopApiExtensions = gql`
    input CreateSellerInput {
        firstName: String!
        lastName: String!
        emailAddress: String!
        password: String!
    }

    input RegisterSellerInput {
        shopName: String!
        seller: CreateSellerInput!
    }

    extend type Mutation {
        registerNewSeller(input: RegisterSellerInput!): Channel
    }
`;
