## TSConfig setup

If not already set up, we need to make sure we have configured tsconfig with:

1. jsx support. Usually create `tsconfig.dashboard.json` like this:
    ```json
    {
      "extends": "./tsconfig.json",
      "compilerOptions": {
        "composite": true,
        "jsx": "react-jsx"
      },
      "include": [
        "src/dashboard/**/*.ts",
        "src/dashboard/**/*.tsx"
      ]
    }
    ```
   then reference it from the appropriate tsconfig.json
    ```
    {
        // ...etc
        "references": [
            {
                "path": "./tsconfig.dashboard.json"
            },
        ]
    }
    ```
   This may already be set up (check this). In an Nx-like monorepo
   where each plugin is a separate project, this will need to be done
   per-plugin.
2. Path mapping.
    ```json
     "paths": {
        // Import alias for the GraphQL types, this needs to point to
        // the location specified in the vite.config.mts file as `gqlOutputPath`
        // so will vary depending on project structure
        "@/gql": ["./apps/server/src/gql/graphql.ts"],
        // This line allows TypeScript to properly resolve internal
        // Vendure Dashboard imports, which is necessary for
        // type safety in your dashboard extensions.
        // This path assumes a root-level tsconfig.json file.
        // You may need to adjust it if your project structure is different.
        "@/vdb/*": [
          "./node_modules/@vendure/dashboard/src/lib/*"
     }
     ```
   In an Nx-like monorepo, this would be added to the tsconfig.base.json or
   equivalent.
