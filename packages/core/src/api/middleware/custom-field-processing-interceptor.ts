import { CallHandler, ExecutionContext, Injectable, NestInterceptor } from '@nestjs/common';
import { ModuleRef } from '@nestjs/core';
import { GqlExecutionContext } from '@nestjs/graphql';
import { isForeignSecretPlaceholder, REDACTED_SECRET_PLACEHOLDER } from '@vendure/common/lib/shared-constants';
import { getGraphQlInputName } from '@vendure/common/lib/shared-utils';
import {
    getNamedType,
    GraphQLSchema,
    OperationDefinitionNode,
    TypeInfo,
    visit,
    visitWithTypeInfo,
} from 'graphql';

import { UserInputError } from '../../common/error/errors';
import { Injector } from '../../common/injector';
import { ConfigService } from '../../config/config.service';
import { CustomFieldConfig, CustomFields } from '../../config/custom-field/custom-field-types';
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
     * Every input type that carries an entity's custom fields, mapped to the owning entity. This
     * includes the standard `Create<Entity>Input`/`Update<Entity>Input` and the alias inputs that
     * embed custom fields under a non-standard name (kept in sync with the extensions added in
     * `graphql-custom-fields.ts`). Used to strip secret redaction placeholders on every write path,
     * not just the standard ones.
     */
    private readonly secretCapableInputs = new Map<string, keyof CustomFields>();
    /**
     * Input types whose value is itself the custom-fields object, rather than an object with a nested
     * `customFields` property.
     */
    private readonly directCustomFieldsInputs = new Set<string>(['OrderLineCustomFieldsInput']);

    constructor(
        private readonly configService: ConfigService,
        private readonly moduleRef: ModuleRef,
    ) {
        const hasFields = (entityName: keyof CustomFields) =>
            (this.configService.customFields[entityName]?.length ?? 0) > 0;
        (Object.keys(configService.customFields) as Array<keyof CustomFields>).forEach(entityName => {
            this.createInputsWithCustomFields.add(`Create${entityName}Input`);
            this.updateInputsWithCustomFields.add(`Update${entityName}Input`);
            if (hasFields(entityName)) {
                this.secretCapableInputs.set(`Create${entityName}Input`, entityName);
                this.secretCapableInputs.set(`Update${entityName}Input`, entityName);
            }
        });
        // Alias input types that embed an entity's custom fields under a non-standard input name.
        const aliases: Array<[string, keyof CustomFields]> = [
            ['UpdateActiveAdministratorInput', 'Administrator'],
            ['RegisterCustomerInput', 'Customer'],
            ['UpdateOrderAddressInput', 'Address'],
            ['ModifyOrderInput', 'Order'],
            ['OrderLineCustomFieldsInput', 'OrderLine'],
            ['AddItemInput', 'OrderLine'],
            ['OrderLineInput', 'OrderLine'],
            ['AddItemToDraftOrderInput', 'OrderLine'],
            ['AdjustDraftOrderLineInput', 'OrderLine'],
        ];
        for (const [inputType, entityName] of aliases) {
            if (hasFields(entityName)) {
                this.secretCapableInputs.set(inputType, entityName);
            }
        }
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

        const inputTypeNames = this.getArgumentMap(operation, schema);

        for (const [inputName, typeName] of Object.entries(inputTypeNames)) {
            if (!variables[inputName]) {
                continue;
            }
            // Strip secret redaction placeholders on every write path that carries custom fields,
            // including the alias inputs the defaults/validation path below does not handle.
            this.stripSecretPlaceholders(typeName, variables[inputName], operation);
            if (this.hasCustomFields(typeName)) {
                await this.processInputVariables(typeName, variables[inputName], ctx, injector, operation);
            }
        }
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

    /**
     * For `secret` custom fields, the API returns a redaction placeholder rather than the real value.
     * When that placeholder is submitted back on an update, the field is removed from the input so the
     * stored (encrypted) value is preserved; otherwise the transformer would encrypt the literal
     * placeholder and destroy the real secret. On a create there is nothing to preserve, so the
     * placeholder is rejected. This runs for every custom-field-carrying input type, including alias
     * inputs such as `UpdateActiveAdministratorInput`, `ModifyOrderInput` and the order-line inputs.
     */
    private stripSecretPlaceholders(
        typeName: string,
        variableInput: any,
        operation: OperationDefinitionNode,
    ) {
        const entityName = this.secretCapableInputs.get(typeName);
        if (!entityName) {
            return;
        }
        const customFieldConfig = this.configService.customFields[entityName];
        if (!customFieldConfig?.some(c => c.secret === true)) {
            return;
        }
        const isDirect = this.directCustomFieldsInputs.has(typeName);
        const isCreate = this.isCreateForSecretStripping(typeName, entityName, operation);
        const inputVariables = Array.isArray(variableInput) ? variableInput : [variableInput];
        for (const inputVariable of inputVariables) {
            const customFieldsObject = isDirect ? inputVariable : inputVariable?.customFields;
            if (!customFieldsObject) {
                continue;
            }
            for (const config of customFieldConfig) {
                if (config.secret !== true) {
                    continue;
                }
                const fieldName = getGraphQlInputName(config);
                const fieldValue = customFieldsObject[fieldName];
                if (fieldValue === REDACTED_SECRET_PLACEHOLDER) {
                    if (isCreate) {
                        throw new UserInputError('error.secret-custom-field-value-required', {
                            name: fieldName,
                        });
                    }
                    delete customFieldsObject[fieldName];
                } else if (isForeignSecretPlaceholder(fieldValue)) {
                    // A placeholder from a different version must not be stored as a real value.
                    throw new UserInputError('error.secret-custom-field-value-required', {
                        name: fieldName,
                    });
                }
            }
        }
    }

    /**
     * Whether the placeholder should be rejected (a create, with nothing to preserve) rather than
     * stripped (an update). When in doubt this returns `false` (treat as update/strip), which is the
     * safe direction: it can never encrypt the literal placeholder over a real secret.
     */
    private isCreateForSecretStripping(
        typeName: string,
        entityName: keyof CustomFields,
        operation: OperationDefinitionNode,
    ): boolean {
        if (this.createInputsWithCustomFields.has(typeName) || typeName === 'RegisterCustomerInput') {
            return true;
        }
        if (entityName === 'OrderLine') {
            return this.isOrderLineCreateOperation(operation);
        }
        return false;
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
