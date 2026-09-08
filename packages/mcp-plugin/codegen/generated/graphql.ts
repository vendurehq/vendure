import { initGraphQLTada } from 'gql.tada';

import type { introspection } from './graphql-env.d.ts';

/**
 * Stands in for a Vendure project's own generated GraphQL types, so this plugin's dashboard
 * code can be type-checked on its own.
 *
 * The dashboard code imports `graphql` from `@/gql`. In a project that installs this plugin,
 * that name resolves to types generated from the whole server, including that project's custom
 * fields. This plugin is not a project, so while developing it here `@/gql` is pointed at this
 * file instead, which describes a server running nothing but this plugin. Nothing in this
 * folder is published to npm or runs at run time.
 *
 * Regenerate the description next to this file with `bun run codegen:dashboard` after changing
 * `src/api/api-extensions.ts`.
 */
export const graphql = initGraphQLTada<{
    disableMasking: true;
    introspection: introspection;
    scalars: {
        DateTime: string;
        JSON: any;
        Money: number;
    };
}>();

export type { FragmentOf, ResultOf, VariablesOf } from 'gql.tada';
