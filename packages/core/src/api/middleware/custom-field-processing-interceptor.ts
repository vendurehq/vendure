import { CallHandler, ExecutionContext, Injectable, NestInterceptor } from '@nestjs/common';
import { ModuleRef } from '@nestjs/core';
import { GqlExecutionContext } from '@nestjs/graphql';
import { getGraphQlInputName } from '@vendure/common/lib/shared-utils';
import {
    getNamedType,
    GraphQLSchema,
    OperationDefinitionNode,
    TypeInfo,
    visit,
    visitWithTypeInfo,
} from 'graphql';

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

        const inputTypeNames = this.getArgumentMap(operation, schema);

        for (const [inputName, typeName] of Object.entries(inputTypeNames)) {
            if (this.hasCustomFields(typeName) && variables[inputName]) {
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
