import { gql } from 'graphql-tag';

export const apiExtensions = gql`
    type Campaign implements Node {
        id: ID!
        createdAt: DateTime!
        updatedAt: DateTime!
        name: String
        code: String!
        promotion: Promotion
        promotionId: ID
        languageCode: LanguageCode!
        translations: [CampaignTranslation!]!
    }

    type CampaignTranslation implements Node {
        id: ID!
        languageCode: LanguageCode!
        name: String!
    }
`;
