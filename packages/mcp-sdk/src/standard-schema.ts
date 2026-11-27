import type { StandardSchema, StandardSchemaIssue, StandardSchemaResult } from '@vendure/common/lib/command';

/**
 * @description
 * One validation failure reported by an {@link McpStandardSchema}.
 *
 * @docsCategory mcp-sdk
 * @since 3.8.0
 */
export type McpStandardSchemaIssue = StandardSchemaIssue;

/**
 * @description
 * The result of validating a value against an {@link McpStandardSchema}: the (possibly
 * transformed) value on success, or a list of issues on failure.
 *
 * @docsCategory mcp-sdk
 * @since 3.8.0
 */
export type McpStandardSchemaResult<Output = unknown> = StandardSchemaResult<Output>;

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
 * @docsCategory mcp-sdk
 * @since 3.8.0
 */
export type McpStandardSchema<Input = unknown, Output = Input> = StandardSchema<Input, Output>;
