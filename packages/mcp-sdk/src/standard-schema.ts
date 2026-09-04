/**
 * @description
 * One validation failure reported by an {@link McpStandardSchema}.
 *
 * @docsCategory core plugins/McpPlugin
 * @since 3.8.0
 */
export interface McpStandardSchemaIssue {
    /**
     * @description
     * A human readable message describing why the value was rejected.
     */
    readonly message: string;
    /**
     * @description
     * Where the rejected value sits inside the validated input. Each segment is a property key,
     * an array index, or an object carrying that key. It is absent when the issue applies to the
     * value as a whole.
     */
    readonly path?: ReadonlyArray<PropertyKey | { readonly key: PropertyKey }>;
}

/**
 * @description
 * The result of validating a value against an {@link McpStandardSchema}: the (possibly
 * transformed) value on success, or a list of issues on failure.
 *
 * @docsCategory core plugins/McpPlugin
 * @since 3.8.0
 */
export type McpStandardSchemaResult<Output = unknown> =
    | { readonly value: Output; readonly issues?: undefined }
    | { readonly issues: readonly McpStandardSchemaIssue[] };

/**
 * @description
 * A schema object implementing the [Standard Schema](https://standardschema.dev/) interface plus
 * its JSON Schema conversion extension. Zod v4, ArkType, and Valibot schemas all implement this
 * shape; it's declared structurally so `@vendure/mcp-sdk` doesn't depend on any schema library.
 *
 * The MCP server converts the schema to JSON Schema once at startup, to advertise the tool, and
 * calls `validate` on every incoming call. The tool's `execute` method receives the validated
 * value, so library features like defaults apply.
 *
 * @docsCategory core plugins/McpPlugin
 * @since 3.8.0
 */
export interface McpStandardSchema<Input = unknown, Output = Input> {
    /**
     * @description
     * The Standard Schema properties that a schema library adds to each of its schemas. The MCP
     * server reads `jsonSchema` once at startup, and calls `validate` on every tool call. The
     * `version`, `vendor` and `types` properties belong to the Standard Schema contract, and are
     * not read by the MCP server.
     */
    readonly '~standard': {
        readonly version: 1;
        readonly vendor: string;
        readonly validate: (
            value: unknown,
        ) => McpStandardSchemaResult<Output> | Promise<McpStandardSchemaResult<Output>>;
        readonly types?: { readonly input: Input; readonly output: Output };
        readonly jsonSchema: {
            input(options: {
                readonly target: string;
                readonly libraryOptions?: Record<string, unknown>;
            }): Record<string, unknown>;
            output(options: {
                readonly target: string;
                readonly libraryOptions?: Record<string, unknown>;
            }): Record<string, unknown>;
        };
    };
}
