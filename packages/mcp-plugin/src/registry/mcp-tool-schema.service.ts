import {
    fromJsonSchema,
    JsonSchemaType,
    StandardSchemaV1,
    StandardSchemaWithJSON,
} from '@modelcontextprotocol/server';
import { Injectable } from '@nestjs/common';
import { McpJsonSchema, McpStandardSchema, McpToolSchema } from '@vendure/mcp-sdk';

const NO_ARGS_SCHEMA: McpJsonSchema = { type: 'object', properties: {}, additionalProperties: false };

export interface McpToolInjectedFields {
    confirm: boolean;
    sessionToken: boolean;
}

export interface PreparedMcpToolSchemas {
    jsonInputSchema: McpJsonSchema;
    wireJsonSchema: McpJsonSchema;
    compiledInputSchema: StandardSchemaWithJSON;
    compiledOutputSchema?: StandardSchemaWithJSON;
}

/** Prepares and validates tool schemas once, when the registry starts. */
@Injectable()
export class McpToolSchemaService {
    prepareToolSchemas(options: {
        toolName: string;
        pluginSource: string;
        inputSchema?: McpToolSchema;
        outputSchema?: McpToolSchema;
        injectedFields: McpToolInjectedFields;
    }): PreparedMcpToolSchemas {
        const { toolName, pluginSource, injectedFields } = options;
        const toolLabel = `MCP tool "${toolName}" (${pluginSource})`;
        const inputLabel = `${toolLabel} inputSchema`;
        const outputLabel = `${toolLabel} outputSchema`;
        const resolvedInput = this.resolveAuthorSchema(options.inputSchema, inputLabel, 'input');
        const resolvedOutput = this.resolveAuthorSchema(options.outputSchema, outputLabel, 'output');
        const jsonInputSchema = resolvedInput?.json ?? NO_ARGS_SCHEMA;

        if (injectedFields.confirm) {
            this.assertNotDeclared({
                toolLabel,
                schema: jsonInputSchema,
                schemaName: 'inputSchema',
                field: 'confirm',
                reason: 'the registry adds it to destructive tools',
            });
        }
        if (injectedFields.sessionToken) {
            const reason = 'the registry adds it to shop tools that use the active order';
            this.assertNotDeclared({
                toolLabel,
                schema: jsonInputSchema,
                schemaName: 'inputSchema',
                field: 'sessionToken',
                reason,
            });
            this.assertNotDeclared({
                toolLabel,
                schema: resolvedOutput?.json,
                schemaName: 'outputSchema',
                field: 'sessionToken',
                reason,
            });
        }

        const wireJsonSchema = this.addInjectedFields(jsonInputSchema, injectedFields);
        const compiledInputSchema = resolvedInput?.standard
            ? this.toRegisteredStandardSchema(resolvedInput.standard, wireJsonSchema, injectedFields)
            : this.compileJsonSchema(wireJsonSchema, inputLabel);
        const compiledOutputSchema = resolvedOutput
            ? this.compileJsonSchema(resolvedOutput.json, outputLabel)
            : undefined;

        return { jsonInputSchema, wireJsonSchema, compiledInputSchema, compiledOutputSchema };
    }

    compileJsonSchema(schema: McpJsonSchema, label: string): StandardSchemaWithJSON {
        try {
            return fromJsonSchema(schema as unknown as JsonSchemaType);
        } catch (e) {
            throw new Error(
                `${label} failed to compile: ${e instanceof Error ? e.message : String(e)}. ` +
                    `Author schemas as JSON Schema 2020-12 without a "$schema" key.`,
            );
        }
    }

    async validate(
        compiled: StandardSchemaWithJSON,
        value: unknown,
    ): Promise<{ ok: true; value: unknown } | { ok: false; message: string }> {
        const result = await compiled['~standard'].validate(value);
        if (result.issues) {
            const message = result.issues.map(issue => this.formatIssue(issue)).join('; ');
            return { ok: false, message };
        }
        return { ok: true, value: result.value };
    }

    /** Adds registry-owned fields to a clone, leaving the author's schema unchanged. */
    private addInjectedFields(
        jsonInputSchema: McpJsonSchema,
        injectedFields: McpToolInjectedFields,
    ): McpJsonSchema {
        if (!injectedFields.confirm && !injectedFields.sessionToken) {
            return jsonInputSchema;
        }
        const wire = structuredClone(jsonInputSchema);
        wire.properties = { ...wire.properties };
        if (injectedFields.confirm) {
            wire.properties.confirm = {
                type: 'boolean',
                description:
                    'Omit on the first call to get a preview. Set to true only after the user has ' +
                    'approved the action.',
            };
        }
        if (injectedFields.sessionToken) {
            wire.properties.sessionToken = {
                type: 'string',
                description:
                    'Session token returned by cart tools. To start a cart, call add_to_cart once without this field. ' +
                    'For later calls, including parallel calls, pass the latest returned token to use the same cart.',
            };
        }
        return wire;
    }

    private formatIssue(issue: StandardSchemaV1.Issue): string {
        const path = (issue.path ?? [])
            .map(segment => (typeof segment === 'object' ? String(segment.key) : String(segment)))
            .join('.');
        return path ? `${path}: ${issue.message}` : issue.message;
    }

    private isMcpJsonSchema(value: unknown): value is McpJsonSchema {
        return typeof value === 'object' && value !== null && (value as { type?: unknown }).type === 'object';
    }

    private standardProps(value: unknown): Record<string, unknown> | undefined {
        if (typeof value !== 'object' || value === null) {
            return undefined;
        }
        const std = (value as Record<string, unknown>)['~standard'];
        return typeof std === 'object' && std !== null ? (std as Record<string, unknown>) : undefined;
    }

    private isStandardSchema(value: unknown): value is McpStandardSchema {
        const std = this.standardProps(value);
        return (
            typeof std?.validate === 'function' &&
            typeof (std.jsonSchema as { input?: unknown } | undefined)?.input === 'function'
        );
    }

    private deriveJsonSchema(
        schema: McpStandardSchema,
        label: string,
        direction: 'input' | 'output',
    ): McpJsonSchema {
        let json: Record<string, unknown>;
        try {
            json = schema['~standard'].jsonSchema[direction]({ target: 'draft-2020-12' });
        } catch (e) {
            throw new Error(
                `${label}: the Standard Schema could not be converted to ` +
                    `JSON Schema: ${e instanceof Error ? e.message : String(e)}`,
            );
        }
        // Standard Schema converters often add this key, but the MCP compiler rejects it.
        delete json.$schema;
        if (!this.isMcpJsonSchema(json)) {
            const type = (json as { type?: unknown }).type;
            // A union converts to anyOf/oneOf with no root type. It is a common authoring mistake
            // and the generic "must describe an object" message does not say how to fix it.
            if (type === undefined && (json.anyOf !== undefined || json.oneOf !== undefined)) {
                throw new Error(
                    `${label}: the Standard Schema is a union (anyOf/oneOf) ` +
                        `at the top level, and an MCP tool input must be a single object. Wrap it in an ` +
                        `object, e.g. z.object({ input: z.discriminatedUnion(...) }).`,
                );
            }
            throw new Error(
                `${label}: the Standard Schema must describe an object at the ` +
                    `top level (the converted JSON Schema has type "${String(type)}").`,
            );
        }
        return json;
    }

    private toRegisteredStandardSchema(
        schema: McpStandardSchema,
        wireJsonSchema: McpJsonSchema,
        injectedFields: McpToolInjectedFields,
    ): StandardSchemaWithJSON {
        const std = schema['~standard'];
        const validate =
            injectedFields.confirm || injectedFields.sessionToken
                ? (value: unknown) => this.validateAroundInjectedFields(std, injectedFields, value)
                : (value: unknown) => std.validate(value);
        return {
            '~standard': {
                version: 1,
                vendor: 'vendure-mcp',
                validate,
                jsonSchema: {
                    input: () => wireJsonSchema as Record<string, unknown>,
                    output: () => wireJsonSchema as Record<string, unknown>,
                },
            },
        } as StandardSchemaWithJSON;
    }

    /** Validates author input separately from the fields the registry adds. */
    private async validateAroundInjectedFields(
        std: McpStandardSchema['~standard'],
        injectedFields: McpToolInjectedFields,
        value: unknown,
    ): Promise<StandardSchemaV1.Result<unknown>> {
        const input = { ...((value ?? {}) as Record<string, unknown>) };
        const held: Record<string, unknown> = {};
        if (injectedFields.confirm && input.confirm !== undefined) {
            if (typeof input.confirm !== 'boolean') {
                return { issues: [{ message: '"confirm" must be a boolean', path: ['confirm'] }] };
            }
            held.confirm = input.confirm;
            delete input.confirm;
        }
        if (injectedFields.sessionToken && input.sessionToken !== undefined) {
            if (typeof input.sessionToken !== 'string') {
                return { issues: [{ message: '"sessionToken" must be a string', path: ['sessionToken'] }] };
            }
            held.sessionToken = input.sessionToken;
            delete input.sessionToken;
        }
        const result = await std.validate(input);
        if (result.issues) {
            return result;
        }
        const parsed = result.value;
        if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
            return {
                issues: [
                    {
                        message:
                            'the input schema of a tool with registry-injected fields ' +
                            'must parse to a plain object',
                    },
                ],
            };
        }
        return { value: { ...parsed, ...held } };
    }

    private assertNotDeclared(check: {
        toolLabel: string;
        schema: McpJsonSchema | undefined;
        schemaName: 'inputSchema' | 'outputSchema';
        field: keyof McpToolInjectedFields;
        reason: string;
    }): void {
        if (check.schema?.properties?.[check.field] !== undefined) {
            throw new Error(
                `${check.toolLabel} must not declare "${check.field}" in its ${check.schemaName}: ${check.reason}.`,
            );
        }
    }

    private resolveAuthorSchema(
        raw: McpToolSchema | undefined,
        label: string,
        direction: 'input' | 'output',
    ): { json: McpJsonSchema; standard?: McpStandardSchema } | undefined {
        if (raw === undefined) {
            return undefined;
        }
        // Some Standard Schema objects also carry `type: 'object'`, so check them first.
        if (this.isStandardSchema(raw)) {
            return { json: this.deriveJsonSchema(raw, label, direction), standard: raw };
        }
        if (typeof this.standardProps(raw)?.validate === 'function') {
            throw new TypeError(
                `${label}: the schema implements Standard Schema validation but ` +
                    `cannot emit JSON Schema. Use a library version with JSON Schema conversion ` +
                    `(e.g. zod v4), or author the schema as plain JSON Schema.`,
            );
        }
        if (this.isMcpJsonSchema(raw)) {
            return { json: raw };
        }
        throw new Error(
            `${label}: the schema must be a plain JSON Schema object ` +
                `({ type: 'object', ... }) or a Standard Schema with JSON conversion (e.g. a zod v4 schema).`,
        );
    }
}
