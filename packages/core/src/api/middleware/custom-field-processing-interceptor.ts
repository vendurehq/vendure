import { CallHandler, ExecutionContext, Injectable, NestInterceptor } from '@nestjs/common';
import { ModuleRef } from '@nestjs/core';
import { GqlExecutionContext } from '@nestjs/graphql';
import { isForeignSecretPlaceholder, REDACTED_SECRET_PLACEHOLDER } from '@vendure/common/lib/shared-constants';
import { getGraphQlInputName } from '@vendure/common/lib/shared-utils';
import {
    getNamedType,
    getNullableType,
    GraphQLInputType,
    GraphQLSchema,
    isInputObjectType,
    isListType,
    OperationDefinitionNode,
    TypeInfo,
    visit,
    visitWithTypeInfo,
} from 'graphql';

import { UserInputError } from '../../common/error/errors';
import { Injector } from '../../common/injector';
import { ConfigService } from '../../config/config.service';
import {
    CUSTOM_FIELDS_INPUT_TYPE_SUFFIX,
    CustomFieldConfig,
    CustomFields,
} from '../../config/custom-field/custom-field-types';
import { parseContext } from '../common/parse-context';
import { internal_getRequestContext, RequestContext } from '../common/request-context';
import { validateCustomFieldValue } from '../common/validate-custom-field-value';

/**
 * @description
 * Unified interceptor that processes custom fields in GraphQL mutations by:
 *
 * 1. Applying default values when fields are explicitly set to null (create operations only)
 * 2. Validating custom field values according to their constraints
 *
 * Uses native GraphQL utilities (visit, visitWithTypeInfo, getNamedType) for efficient
 * AST traversal and type analysis.
 */
@Injectable()
export class CustomFieldProcessingInterceptor implements NestInterceptor {
    private readonly createInputsWithCustomFields = new Set<string>();
    private readonly updateInputsWithCustomFields = new Set<string>();
    /**
     * Per-schema cache mapping the name of each `*CustomFieldsInput` type to the set of its `secret`
     * field input-names. Built lazily from the schema (see {@link getSecretFieldsByInputType}) so that
     * secret redaction placeholders are stripped wherever custom fields appear in a mutation input,
     * regardless of the (arbitrary) name of the enclosing input type.
     */
    private readonly secretFieldsByInputTypeCache = new WeakMap<GraphQLSchema, Map<string, Set<string>>>();

    constructor(
        private readonly configService: ConfigService,
        private readonly moduleRef: ModuleRef,
    ) {
        Object.keys(configService.customFields).forEach(entityName => {
            this.createInputsWithCustomFields.add(`Create${entityName}Input`);
            this.updateInputsWithCustomFields.add(`Update${entityName}Input`);
        });
        // Note: OrderLineCustomFieldsInput is handled separately since it's used in both
        // create operations (addItemToOrder) and update operations (adjustOrderLine)
    }

    async intercept(context: ExecutionContext, next: CallHandler<any>) {
        const parsedContext = parseContext(context);

        if (!parsedContext.isGraphQL) {
            return next.handle();
        }

        const { operation, schema } = parsedContext.info;
        if (operation.operation === 'mutation') {
            await this.processMutationCustomFields(context, operation, schema);
        }

        return next.handle();
    }

    private async processMutationCustomFields(
        context: ExecutionContext,
        operation: OperationDefinitionNode,
        schema: GraphQLSchema,
    ) {
        const gqlExecutionContext = GqlExecutionContext.create(context);
        const variables = gqlExecutionContext.getArgs();
        const ctx = internal_getRequestContext(parseContext(context).req);
        const injector = new Injector(this.moduleRef);

        // Strip secret redaction placeholders anywhere custom fields appear in the mutation input,
        // discovered from the schema so it does not depend on the enclosing input type's name.
        this.stripSecretPlaceholders(operation, schema, variables);

        const inputTypeNames = this.getArgumentMap(operation, schema);
        for (const [inputName, typeName] of Object.entries(inputTypeNames)) {
            if (this.hasCustomFields(typeName) && variables[inputName]) {
                await this.processInputVariables(typeName, variables[inputName], ctx, injector, operation);
            }
        }
    }

    /**
     * Removes `secret` custom-field redaction placeholders from the mutation input before it reaches
     * the database. When the API redacts a secret on read, the placeholder is what an edit form
     * submits back; if it were persisted, the encryption transformer would encrypt the literal
     * placeholder and destroy the stored secret. Placeholders are therefore stripped (leaving the
     * stored value untouched), and a placeholder from a different Vendure version is rejected.
     *
     * The locations of custom fields are discovered from the schema — any value sitting at a position
     * typed as a `*CustomFieldsInput` type is a custom-fields object — so this works for every input
     * that carries custom fields (e.g. `updateActiveAdministrator`, `modifyOrder`, the order-line
     * inputs, and any future or plugin-defined mutation) without a hand-maintained list of input names.
     */
    private stripSecretPlaceholders(
        operation: OperationDefinitionNode,
        schema: GraphQLSchema,
        variables: Record<string, any>,
    ) {
        const secretFieldsByInputType = this.getSecretFieldsByInputType(schema);
        if (secretFieldsByInputType.size === 0) {
            return;
        }
        const mutationType = schema.getMutationType();
        if (!mutationType) {
            return;
        }
        const mutationFields = mutationType.getFields();
        for (const selection of operation.selectionSet.selections) {
            if (selection.kind !== 'Field') {
                continue;
            }
            const fieldDef = mutationFields[selection.name.value];
            if (!fieldDef) {
                continue;
            }
            for (const arg of fieldDef.args) {
                if (arg.name in variables) {
                    // On a create there is no stored value to preserve, so a placeholder is rejected
                    // rather than stripped. This is best-effort (set membership against the generated
                    // create inputs); when unknown it defaults to stripping, which is always safe.
                    const isCreate = this.createInputsWithCustomFields.has(getNamedType(arg.type).name);
                    this.walkAndStripSecrets(
                        variables[arg.name],
                        arg.type,
                        secretFieldsByInputType,
                        isCreate,
                    );
                }
            }
        }
    }

    /**
     * Recursively descends a mutation input value against its GraphQL input type. Wherever the value
     * sits at a position typed as a `*CustomFieldsInput` type, its `secret` fields have their redaction
     * placeholders stripped.
     */
    private walkAndStripSecrets(
        value: any,
        type: GraphQLInputType,
        secretFieldsByInputType: Map<string, Set<string>>,
        isCreate: boolean,
    ) {
        if (value == null) {
            return;
        }
        const nullableType = getNullableType(type);
        if (isListType(nullableType)) {
            if (Array.isArray(value)) {
                for (const item of value) {
                    this.walkAndStripSecrets(item, nullableType.ofType, secretFieldsByInputType, isCreate);
                }
            }
            return;
        }
        if (isInputObjectType(nullableType) && typeof value === 'object') {
            const secretFields = secretFieldsByInputType.get(nullableType.name);
            if (secretFields) {
                this.stripSecretPlaceholdersFromObject(value, secretFields, isCreate);
            }
            const fields = nullableType.getFields();
            for (const [fieldName, field] of Object.entries(fields)) {
                if (fieldName in value) {
                    this.walkAndStripSecrets(value[fieldName], field.type, secretFieldsByInputType, isCreate);
                }
            }
        }
    }

    private stripSecretPlaceholdersFromObject(
        customFieldsObject: any,
        secretFields: Set<string>,
        isCreate: boolean,
    ) {
        for (const fieldName of secretFields) {
            const fieldValue = customFieldsObject[fieldName];
            if (fieldValue === REDACTED_SECRET_PLACEHOLDER) {
                if (isCreate) {
                    throw new UserInputError('error.secret-custom-field-value-required', { name: fieldName });
                }
                // Preserve the stored value by not submitting anything for this field.
                delete customFieldsObject[fieldName];
            } else if (isForeignSecretPlaceholder(fieldValue)) {
                // A placeholder from a different version must not be stored as a real value.
                throw new UserInputError('error.secret-custom-field-value-required', { name: fieldName });
            }
        }
    }

    /**
     * Builds, per schema, a map from each `*CustomFieldsInput` type name to the set of its `secret`
     * field input-names. The owning entity is resolved from the type name (e.g.
     * `UpdateAdministratorCustomFieldsInput` → `Administrator`) by the longest matching custom-field
     * entity name, which is unambiguous because these type names are generated as
     * `<verb><Entity>CustomFieldsInput`.
     */
    private getSecretFieldsByInputType(schema: GraphQLSchema): Map<string, Set<string>> {
        const cached = this.secretFieldsByInputTypeCache.get(schema);
        if (cached) {
            return cached;
        }
        const map = new Map<string, Set<string>>();
        const suffix = CUSTOM_FIELDS_INPUT_TYPE_SUFFIX;
        const entityNames = (Object.keys(this.configService.customFields) as Array<keyof CustomFields>).sort(
            (a, b) => (b as string).length - (a as string).length,
        );
        for (const type of Object.values(schema.getTypeMap())) {
            if (!isInputObjectType(type) || !type.name.endsWith(suffix)) {
                continue;
            }
            const prefix = type.name.slice(0, -suffix.length);
            const entityName = entityNames.find(name => prefix.endsWith(name as string));
            if (!entityName) {
                continue;
            }
            const secretFieldNames = (this.configService.customFields[entityName] ?? [])
                .filter(config => config.secret === true)
                .map(config => getGraphQlInputName(config));
            if (secretFieldNames.length) {
                map.set(type.name, new Set(secretFieldNames));
            }
        }
        this.secretFieldsByInputTypeCache.set(schema, map);
        return map;
    }

    private hasCustomFields(typeName: string): boolean {
        return (
            this.createInputsWithCustomFields.has(typeName) ||
            this.updateInputsWithCustomFields.has(typeName) ||
            typeName === 'OrderLineCustomFieldsInput'
        );
    }

    private async processInputVariables(
        typeName: string,
        variableInput: any,
        ctx: RequestContext,
        injector: Injector,
        operation: OperationDefinitionNode,
    ) {
        const inputVariables = Array.isArray(variableInput) ? variableInput : [variableInput];
        const shouldApplyDefaults = this.shouldApplyDefaults(typeName, operation);

        for (const inputVariable of inputVariables) {
            if (shouldApplyDefaults) {
                this.applyDefaultsToInput(typeName, inputVariable);
            }
            await this.validateInput(typeName, ctx, injector, inputVariable);
        }
    }

    private shouldApplyDefaults(typeName: string, operation: OperationDefinitionNode): boolean {
        // For regular create inputs, always apply defaults
        if (this.createInputsWithCustomFields.has(typeName)) {
            return true;
        }

        // For OrderLineCustomFieldsInput, check the actual mutation name
        if (typeName === 'OrderLineCustomFieldsInput') {
            return this.isOrderLineCreateOperation(operation);
        }

        // For update inputs, never apply defaults
        return false;
    }

    private isOrderLineCreateOperation(operation: OperationDefinitionNode): boolean {
        // Check if any field in the operation is a "create/add" operation for order lines
        for (const selection of operation.selectionSet.selections) {
            if (selection.kind === 'Field') {
                const fieldName = selection.name.value;
                // These mutations create new order lines, so should apply defaults
                if (fieldName === 'addItemToOrder' || fieldName === 'addItemToDraftOrder') {
                    return true;
                }
                // These mutations modify existing order lines, so should NOT apply defaults
                if (fieldName === 'adjustOrderLine' || fieldName === 'adjustDraftOrderLine') {
                    return false;
                }
            }
        }
        // Default to false for safety (don't apply defaults unless we're sure it's a create)
        return false;
    }

    private getArgumentMap(
        operation: OperationDefinitionNode,
        schema: GraphQLSchema,
    ): { [inputName: string]: string } {
        const typeInfo = new TypeInfo(schema);
        const map: { [inputName: string]: string } = {};

        const visitor = {
            enter(node: any) {
                if (node.kind === 'Field') {
                    const fieldDef = typeInfo.getFieldDef();
                    if (fieldDef) {
                        for (const arg of fieldDef.args) {
                            map[arg.name] = getNamedType(arg.type).name;
                        }
                    }
                }
            },
        };

        visit(operation, visitWithTypeInfo(typeInfo, visitor));
        return map;
    }

    private applyDefaultsToInput(typeName: string, variableValues: any) {
        if (typeName === 'OrderLineCustomFieldsInput') {
            this.applyDefaultsForOrderLine(variableValues);
        } else {
            this.applyDefaultsForEntity(typeName, variableValues);
        }
    }

    private applyDefaultsForOrderLine(variableValues: any) {
        const orderLineConfig = this.configService.customFields.OrderLine || [];
        this.applyDefaultsToCustomFieldsObject(orderLineConfig, variableValues);
    }

    private applyDefaultsForEntity(typeName: string, variableValues: any) {
        const entityName = this.getEntityNameFromInputType(typeName);
        const customFieldConfig = this.configService.customFields[entityName];

        if (!customFieldConfig) {
            return;
        }

        this.applyDefaultsToDirectCustomFields(customFieldConfig, variableValues);
        this.applyDefaultsToTranslationCustomFields(customFieldConfig, variableValues);
    }

    private applyDefaultsToDirectCustomFields(customFieldConfig: any[], variableValues: any) {
        if (variableValues.customFields) {
            this.applyDefaultsToCustomFieldsObject(customFieldConfig, variableValues.customFields);
        }
    }

    private applyDefaultsToTranslationCustomFields(customFieldConfig: any[], variableValues: any) {
        if (!variableValues.translations || !Array.isArray(variableValues.translations)) {
            return;
        }

        for (const translation of variableValues.translations) {
            if (translation.customFields) {
                this.applyDefaultsToCustomFieldsObject(customFieldConfig, translation.customFields);
            }
        }
    }

    private applyDefaultsToCustomFieldsObject(customFieldConfig: any[], customFieldsObject: any) {
        for (const config of customFieldConfig) {
            const fieldName = getGraphQlInputName(config);
            // Only apply default if the field is explicitly null and has a default value
            if (customFieldsObject[fieldName] === null && config.defaultValue !== undefined) {
                customFieldsObject[fieldName] = config.defaultValue;
            }
        }
    }

    private getEntityNameFromInputType(typeName: string): string {
        // Remove "Create" or "Update" prefix and "Input" suffix
        // e.g., "CreateProductInput" -> "Product", "UpdateCustomerInput" -> "Customer"
        if (typeName.startsWith('Create')) {
            return typeName.slice(6, -5); // Remove "Create" and "Input"
        }
        if (typeName.startsWith('Update')) {
            return typeName.slice(6, -5); // Remove "Update" and "Input"
        }
        return typeName;
    }

    private async validateInput(
        typeName: string,
        ctx: RequestContext,
        injector: Injector,
        variableValues?: { [key: string]: any },
    ) {
        if (variableValues) {
            const entityName = typeName.replace(/(Create|Update)(.+)Input/, '$2');
            const customFieldConfig = this.configService.customFields[entityName as keyof CustomFields];

            if (typeName === 'OrderLineCustomFieldsInput') {
                // special case needed to handle custom fields passed via addItemToOrder or adjustOrderLine
                // mutations.
                await this.validateCustomFieldsObject(
                    this.configService.customFields.OrderLine,
                    ctx,
                    variableValues,
                    injector,
                );
            }
            if (variableValues.customFields) {
                await this.validateCustomFieldsObject(
                    customFieldConfig,
                    ctx,
                    variableValues.customFields,
                    injector,
                );
            }
            const translations = variableValues.translations;
            if (Array.isArray(translations)) {
                for (const translation of translations) {
                    if (translation.customFields) {
                        await this.validateCustomFieldsObject(
                            customFieldConfig,
                            ctx,
                            translation.customFields,
                            injector,
                        );
                    }
                }
            }
        }
    }

    private async validateCustomFieldsObject(
        customFieldConfig: CustomFieldConfig[],
        ctx: RequestContext,
        customFieldsObject: { [key: string]: any },
        injector: Injector,
    ) {
        for (const [key, value] of Object.entries(customFieldsObject)) {
            const config = customFieldConfig.find(c => getGraphQlInputName(c) === key);
            if (config) {
                await validateCustomFieldValue(config, value, injector, ctx);
            }
        }
    }
}
