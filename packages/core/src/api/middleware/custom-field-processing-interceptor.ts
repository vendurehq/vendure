import { CallHandler, ExecutionContext, Injectable, NestInterceptor } from '@nestjs/common';
import { ModuleRef } from '@nestjs/core';
import { GqlExecutionContext } from '@nestjs/graphql';
import {
    isForeignSecretPlaceholder,
    REDACTED_SECRET_PLACEHOLDER,
} from '@vendure/common/lib/shared-constants';
import { getGraphQlInputName } from '@vendure/common/lib/shared-utils';
import {
    getNamedType,
    getNullableType,
    GraphQLField,
    GraphQLInputType,
    GraphQLSchema,
    isInputObjectType,
    isListType,
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
 * Scoped to the field being resolved via info.fieldName, ensuring correct type
 * resolution even when a single document contains multiple mutation fields.
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

        // RegisterCustomerInput carries Customer custom fields but is not named CreateCustomerInput.
        // getEntityNameFromInputType() maps it back to Customer.
        this.createInputsWithCustomFields.add('RegisterCustomerInput');
    }

    async intercept(context: ExecutionContext, next: CallHandler<any>) {
        const parsedContext = parseContext(context);

        if (!parsedContext.isGraphQL) {
            return next.handle();
        }

        const { operation, schema, fieldName } = parsedContext.info;
        if (operation.operation === 'mutation') {
            await this.processMutationCustomFields(context, schema, fieldName);
        }

        return next.handle();
    }

    private async processMutationCustomFields(
        context: ExecutionContext,
        schema: GraphQLSchema,
        fieldName: string,
    ) {
        const gqlExecutionContext = GqlExecutionContext.create(context);
        const args = gqlExecutionContext.getArgs();
        const ctx = internal_getRequestContext(parseContext(context).req);
        const injector = new Injector(this.moduleRef);

        const mutationType = schema.getMutationType();
        const fieldDef = mutationType?.getFields()[fieldName];
        if (!fieldDef) {
            return;
        }

        this.stripSecretPlaceholders(fieldDef, schema, args);

        for (const arg of fieldDef.args) {
            const typeName = getNamedType(arg.type).name;
            if (this.hasCustomFields(typeName) && args[arg.name]) {
                await this.processInputVariables(typeName, args[arg.name], ctx, injector, fieldName);
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
        fieldDef: GraphQLField<unknown, unknown>,
        schema: GraphQLSchema,
        args: Record<string, any>,
    ) {
        const secretFieldsByInputType = this.getSecretFieldsByInputType(schema);
        if (secretFieldsByInputType.size === 0) {
            return;
        }
        for (const arg of fieldDef.args) {
            if (arg.name in args) {
                // On a create there is no stored value to preserve, so the placeholder is rejected
                // rather than stripped. Only the generated `Create<Entity>Input` types and
                // `RegisterCustomerInput` count as creates. A create through any other input type has
                // the placeholder stripped (#5514).
                const isCreate = this.createInputsWithCustomFields.has(getNamedType(arg.type).name);
                this.walkAndStripSecrets(args[arg.name], arg.type, secretFieldsByInputType, isCreate);
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
        fieldName: string,
    ) {
        const inputVariables = Array.isArray(variableInput) ? variableInput : [variableInput];
        const shouldApplyDefaults = this.shouldApplyDefaults(typeName, fieldName);

        for (const inputVariable of inputVariables) {
            if (shouldApplyDefaults) {
                this.applyDefaultsToInput(typeName, inputVariable);
            }
            await this.validateInput(typeName, ctx, injector, inputVariable);
        }
    }

    private shouldApplyDefaults(typeName: string, fieldName: string): boolean {
        // For regular create inputs, always apply defaults
        if (this.createInputsWithCustomFields.has(typeName)) {
            return true;
        }

        // Defaults apply only to addItemToOrder, because in adjustOrderLine null unsets the field.
        // Mutations which nest OrderLineCustomFieldsInput in another input type get neither defaults
        // nor validation from this interceptor (#5513).
        if (typeName === 'OrderLineCustomFieldsInput') {
            return fieldName === 'addItemToOrder';
        }

        // For update inputs, never apply defaults
        return false;
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
            const name = getGraphQlInputName(config);
            // Only apply default if the field is explicitly null and has a default value
            if (customFieldsObject[name] === null && config.defaultValue !== undefined) {
                customFieldsObject[name] = config.defaultValue;
            }
        }
    }

    private getEntityNameFromInputType(typeName: string): string {
        if (typeName === 'RegisterCustomerInput') {
            // Added to createInputsWithCustomFields in the constructor.
            return 'Customer';
        }
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
            const entityName = this.getEntityNameFromInputType(typeName);
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
