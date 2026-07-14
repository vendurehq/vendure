import { graphql, ResultOf } from './graphql.js';

export const assetFragment = graphql(`
    fragment Asset on Asset {
        id
        createdAt
        updatedAt
        languageCode
        name
        fileSize
        mimeType
        type
        preview
        source
        width
        height
        focalPoint {
            x
            y
        }
        translations {
            id
            languageCode
            name
        }
    }
`);

export type AssetFragment = ResultOf<typeof assetFragment>;

export const configurableOperationFragment = graphql(`
    fragment ConfigurableOperation on ConfigurableOperation {
        args {
            name
            value
        }
        code
    }
`);

export type ConfigurableOperationFragment = ResultOf<typeof configurableOperationFragment>;

export const configArgDefinitionFragment = graphql(`
    fragment ConfigArgDefinition on ConfigArgDefinition {
        name
        type
        required
        defaultValue
        list
        ui
        label
        description
    }
`);

export const configurableOperationDefFragment = graphql(
    `
        fragment ConfigurableOperationDef on ConfigurableOperationDefinition {
            args {
                ...ConfigArgDefinition
            }
            code
            description
        }
    `,
    [configArgDefinitionFragment],
);

export const errorResultFragment = graphql(`
    fragment ErrorResult on ErrorResult {
        errorCode
        message
    }
`);

export type ConfigurableOperationDefFragment = ResultOf<typeof configurableOperationDefFragment>;
export type ConfigArgDefFragment = ResultOf<typeof configArgDefinitionFragment>;
