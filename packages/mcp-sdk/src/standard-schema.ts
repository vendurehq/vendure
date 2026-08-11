/**
 * @description
 * One validation failure reported by an {@link McpStandardSchema}.
 *
 * @docsCategory core plugins/McpPlugin
 * @since 3.8.0
 */
export interface McpStandardSchemaIssue {
    readonly message: string;
    readonly path?: ReadonlyArray<PropertyKey | { readonly key: PropertyKey }> | undefined;
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
 * A schema object implementing the [Standard Schema](https://standardschema.dev/) interface
 * together with its JSON Schema conversion extension. Zod v4, ArkType, and Valibot schemas
 * all implement this shape. It is declared structurally so that `@vendure/mcp-sdk` does not
 * depend on any schema library.
 *
 * The MCP server converts the schema to JSON Schema once at startup (to advertise the tool)
 * and calls its `validate` function on every incoming tool call; the tool's `execute` method
 * receives the validated value, so library features like defaults apply.
 *
 * @docsCategory core plugins/McpPlugin
 * @since 3.8.0
 */
export interface McpStandardSchema<Input = unknown, Output = Input> {
    readonly '~standard': {
        readonly version: 1;
        readonly vendor: string;
        readonly validate: (
            value: unknown,
        ) => McpStandardSchemaResult<Output> | Promise<McpStandardSchemaResult<Output>>;
        readonly types?: { readonly input: Input; readonly output: Output } | undefined;
        readonly jsonSchema: {
            input(options: {
                readonly target: string;
                readonly libraryOptions?: Record<string, unknown> | undefined;
            }): Record<string, unknown>;
            output(options: {
                readonly target: string;
                readonly libraryOptions?: Record<string, unknown> | undefined;
            }): Record<string, unknown>;
        };
    };
}
