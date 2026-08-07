import { initGraphQLTada } from 'gql.tada';
import type { introspection } from './graphql-env.d.ts';

export const graphql = initGraphQLTada<{
    disableMasking: true;
    introspection: introspection;
    scalars: {
        DateTime: string;
        JSON: any;
        Money: number;
        Upload: File;
    };
}>();

export { readFragment } from 'gql.tada';
export type { FragmentOf, ResultOf, VariablesOf } from 'gql.tada';
