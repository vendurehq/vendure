import { CallHandler, ExecutionContext, Injectable, NestInterceptor } from '@nestjs/common';
import { ModuleRef } from '@nestjs/core';
import { GqlExecutionContext } from '@nestjs/graphql';
import {
    isForeignSecretPlaceholder,
    REDACTED_SECRET_PLACEHOLDER,
} from '@vendure/common/lib/shared-constants';
import { ID } from '@vendure/common/lib/shared-types';
import { getGraphQlInputName } from '@vendure/common/lib/shared-utils';
import {
    getNamedType,
    getNullableType,
    GraphQLField,
    GraphQLInputObjectType,
    GraphQLInputType,
    GraphQLSchema,
    isInputObjectType,
    isListType,
} from 'graphql';
import { isDeepStrictEqual } from 'node:util';
import { In } from 'typeorm';

import { UserInputError } from '../../common/error/errors';
import { Injector } from '../../common/injector';
import { idsAreEqual } from '../../common/utils';
import { ConfigService } from '../../config/config.service';
import {
    CUSTOM_FIELDS_INPUT_TYPE_SUFFIX,
    CustomFieldConfig,
    CustomFields,
} from '../../config/custom-field/custom-field-types';
import { findOptionsArrayToObject } from '../../connection/find-options-array-to-object';
import { TransactionalConnection } from '../../connection/transactional-connection';
import { OrderLine } from '../../entity/order-line/order-line.entity';
import { parseContext } from '../common/parse-context';
import { internal_getRequestContext, RequestContext } from '../common/request-context';
import { userHasPermissionsOnCustomField } from '../common/user-has-permissions-on-custom-field';
import { validateCustomFieldValue } from '../common/validate-custom-field-value';
import { ORDER_LINE_ADD_INPUT_TYPES, ORDER_LINE_ADJUST_INPUT_TYPES } from '../config/graphql-custom-fields';

const ORDER_LINE_CUSTOM_FIELDS_INPUT = 'OrderLineCustomFieldsInput';

type InputParent = { name: string; value: any };

/**
 * Returns whether an `OrderLineCustomFieldsInput` value adds a new order line or adjusts an existing
 * one. OrderLine defaults are applied only where a value adds a line. Where a value adjusts a line, null
 * unsets a field, and a default would overwrite that null.
 *
 * For any other value, such as the `customFields` of a `cancelOrder` line, this function returns
 * undefined, and the interceptor does not process the value. An `OrderLineInput` value adjusts a line only
 * in `modifyOrder` (see {@link ORDER_LINE_ADJUST_INPUT_TYPES}).
 */
function getOrderLinePosition(mutationName: string, parent: InputParent): 'add' | 'adjust' | undefined {
    if (parent.name === mutationName) {
        // The value is a direct argument of the mutation.
        if (mutationName === 'addItemToOrder') {
            return 'add';
        }
        return mutationName === 'adjustOrderLine' ? 'adjust' : undefined;
    }
    if (ORDER_LINE_ADD_INPUT_TYPES.includes(parent.name)) {
        return 'add';
    }
    if (parent.name === 'OrderLineInput') {
        return mutationName === 'modifyOrder' ? 'adjust' : undefined;
    }
    return ORDER_LINE_ADJUST_INPUT_TYPES.includes(parent.name) ? 'adjust' : undefined;
}

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
                await this.processInputVariables(typeName, args[arg.name], ctx, injector);
            }
        }
        await this.processOrderLineCustomFields(fieldDef, args, ctx, injector);
    }

    /**
     * Finds each `OrderLineCustomFieldsInput` value which adds or adjusts an order line (see
     * {@link getOrderLinePosition}). A value can be a direct argument, as in `addItemToOrder`, or nested in
     * another input type, as in `addItemsToOrder`, `addItemToDraftOrder`, `adjustDraftOrderLine` and
     * `modifyOrder`. Each value is processed in this order:
     *
     * 1. In the Admin API, removeNullProtectedFields() runs on a value which adds a line, and
     *    removeUnchangedProtectedFields() runs on a value which adjusts a line.
     * 2. A value which adds a line gets the OrderLine defaults.
     * 3. validateCustomFieldsObject() validates the value.
     */
    private async processOrderLineCustomFields(
        fieldDef: GraphQLField<unknown, unknown>,
        args: Record<string, any>,
        ctx: RequestContext,
        injector: Injector,
    ) {
        const orderLineConfig = this.configService.customFields.OrderLine ?? [];
        if (orderLineConfig.length === 0) {
            return;
        }
        const found: Array<{ customFields: any; orderLineId?: ID }> = [];
        const adjusted: Array<{ customFields: any; orderLineId?: ID }> = [];
        for (const arg of fieldDef.args) {
            if (arg.name in args) {
                const parent = { name: fieldDef.name, value: args };
                this.walkInputObjects(args[arg.name], arg.type, parent, (value, type, valueParent) => {
                    if (type.name !== ORDER_LINE_CUSTOM_FIELDS_INPUT) {
                        return;
                    }
                    const position = getOrderLinePosition(fieldDef.name, valueParent);
                    const entry = { customFields: value, orderLineId: valueParent.value?.orderLineId };
                    if (position === 'add') {
                        if (ctx.apiType === 'admin') {
                            this.removeNullProtectedFields(ctx, orderLineConfig, value);
                        }
                        this.applyDefaultsToCustomFieldsObject(orderLineConfig, value);
                        found.push(entry);
                    } else if (position === 'adjust') {
                        adjusted.push(entry);
                        found.push(entry);
                    }
                });
            }
        }
        if (ctx.apiType === 'admin' && adjusted.length) {
            await this.removeUnchangedProtectedFields(ctx, injector, orderLineConfig, adjusted);
        }
        for (const { customFields } of found) {
            await this.validateCustomFieldsObject(orderLineConfig, ctx, customFields, injector);
        }
    }

    /**
     * Admin clients such as the Dashboard send every OrderLine custom field for an added line, with null
     * for each field the administrator has not filled in. That includes readonly fields, and fields the
     * administrator cannot read. validateCustomFieldValue() rejects both kinds of field whenever the key
     * is present, so adding the line would fail.
     *
     * This method removes each readonly field, and each field the administrator cannot read, whose value
     * is null. The new line then gets the database column default for the field, as it does when the key
     * is absent.
     */
    private removeNullProtectedFields(
        ctx: RequestContext,
        orderLineConfig: CustomFieldConfig[],
        customFields: Record<string, any>,
    ) {
        for (const config of orderLineConfig) {
            const name = getGraphQlInputName(config);
            if (
                customFields[name] === null &&
                (config.readonly || !userHasPermissionsOnCustomField(ctx, config))
            ) {
                delete customFields[name];
            }
        }
    }

    /**
     * Admin clients such as the Dashboard send a line's whole `customFields` object when they adjust the
     * line's quantity. That object contains readonly fields. It also contains fields the administrator
     * cannot read, and the Admin API returns those fields as null. validateCustomFieldValue() rejects
     * both kinds of field whenever the key is present, so the quantity change would fail.
     *
     * This method removes two kinds of field from the input, and the stored values of those fields stay
     * unchanged. The first is a readonly field whose submitted value equals the stored value. The second is
     * a field the administrator cannot read, submitted as null. Any other value stays in the input, and
     * validateCustomFieldValue() rejects it.
     *
     * A field the administrator cannot read is never compared with the stored value. If it were, the
     * error or its absence would reveal whether a guessed value is the stored value. The order lines are
     * loaded only from the active Channel, so the comparison reveals nothing about order lines in other
     * Channels.
     */
    private async removeUnchangedProtectedFields(
        ctx: RequestContext,
        injector: Injector,
        orderLineConfig: CustomFieldConfig[],
        adjusted: Array<{ customFields: Record<string, any>; orderLineId?: ID }>,
    ) {
        const toCompare: Array<{ customFields: Record<string, any>; orderLineId: ID }> = [];
        const readonlyFields = new Set<CustomFieldConfig>();
        for (const { customFields, orderLineId } of adjusted) {
            let hasReadonlyField = false;
            for (const config of orderLineConfig) {
                const name = getGraphQlInputName(config);
                if (!(name in customFields)) {
                    continue;
                }
                if (!userHasPermissionsOnCustomField(ctx, config)) {
                    if (customFields[name] === null) {
                        delete customFields[name];
                    }
                } else if (config.readonly) {
                    readonlyFields.add(config);
                    hasReadonlyField = true;
                }
            }
            if (hasReadonlyField && orderLineId != null) {
                toCompare.push({ customFields, orderLineId });
            }
        }
        if (toCompare.length === 0) {
            return;
        }
        const relationFields = [...readonlyFields].filter(config => config.type === 'relation');
        const orderLines = await injector
            .get(TransactionalConnection)
            .getRepository(ctx, OrderLine)
            .find({
                where: {
                    id: In(toCompare.map(({ orderLineId }) => orderLineId)),
                    order: { channels: { id: ctx.channelId } },
                },
                relations: findOptionsArrayToObject<OrderLine>(
                    relationFields.map(config => `customFields.${config.name}`),
                ),
            });
        for (const { customFields, orderLineId } of toCompare) {
            const orderLine = orderLines.find(line => idsAreEqual(line.id, orderLineId));
            if (!orderLine) {
                continue;
            }
            for (const config of readonlyFields) {
                const name = getGraphQlInputName(config);
                const storedValue = (orderLine.customFields as Record<string, any>)[config.name];
                if (
                    name in customFields &&
                    isStoredCustomFieldValue(config, customFields[name], storedValue)
                ) {
                    delete customFields[name];
                }
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
                const parent = { name: fieldDef.name, value: args };
                this.walkInputObjects(args[arg.name], arg.type, parent, (value, type) => {
                    const secretFields = secretFieldsByInputType.get(type.name);
                    if (secretFields) {
                        this.stripSecretPlaceholdersFromObject(value, secretFields, isCreate);
                    }
                });
            }
        }
    }

    /**
     * Descends a mutation argument value against its GraphQL input type and calls `visit` for every input
     * object in the value. `visit` runs before walkInputObjects() descends into the object's fields, so
     * walkInputObjects() does not descend into a field which `visit` deletes. `parent` is the enclosing
     * input object and the name of its type. For a direct argument, `parent` is the arguments object and
     * the name of the mutation field.
     */
    private walkInputObjects(
        value: any,
        type: GraphQLInputType,
        parent: InputParent,
        visit: (value: any, type: GraphQLInputObjectType, parent: InputParent) => void,
    ) {
        if (value == null) {
            return;
        }
        const nullableType = getNullableType(type);
        if (isListType(nullableType)) {
            if (Array.isArray(value)) {
                for (const item of value) {
                    this.walkInputObjects(item, nullableType.ofType, parent, visit);
                }
            }
            return;
        }
        if (isInputObjectType(nullableType) && typeof value === 'object') {
            visit(value, nullableType, parent);
            const fields = nullableType.getFields();
            for (const [fieldName, field] of Object.entries(fields)) {
                if (fieldName in value) {
                    const fieldParent = { name: nullableType.name, value };
                    this.walkInputObjects(value[fieldName], field.type, fieldParent, visit);
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
            this.createInputsWithCustomFields.has(typeName) || this.updateInputsWithCustomFields.has(typeName)
        );
    }

    private async processInputVariables(
        typeName: string,
        variableInput: any,
        ctx: RequestContext,
        injector: Injector,
    ) {
        const inputVariables = Array.isArray(variableInput) ? variableInput : [variableInput];
        // An update input uses null to unset a field, and a default would overwrite that null.
        const shouldApplyDefaults = this.createInputsWithCustomFields.has(typeName);

        for (const inputVariable of inputVariables) {
            if (shouldApplyDefaults) {
                this.applyDefaultsForEntity(typeName, inputVariable);
            }
            await this.validateInput(typeName, ctx, injector, inputVariable);
        }
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

/**
 * Returns true when a submitted OrderLine custom field value equals the stored value. Postgres and MySQL
 * reorder the keys of a stored JSON object, so a `struct` value is compared without regard to key order.
 */
export function isStoredCustomFieldValue(
    config: CustomFieldConfig,
    inputValue: any,
    storedValue: any,
): boolean {
    if (config.type === 'relation') {
        if (config.list) {
            const inputIds = ((inputValue as ID[] | null) ?? [])
                .map(String)
                .sort((a, b) => a.localeCompare(b));
            const storedIds = ((storedValue as Array<{ id: ID }> | null) ?? [])
                .map(e => String(e.id))
                .sort((a, b) => a.localeCompare(b));
            return isDeepStrictEqual(inputIds, storedIds);
        }
        return inputValue == null ? storedValue == null : idsAreEqual(inputValue, storedValue?.id);
    }
    // The MySQL driver returns a boolean column as 0 or 1, which would not equal a submitted boolean.
    const stored = config.type === 'boolean' && typeof storedValue === 'number' ? !!storedValue : storedValue;
    // Serializing both values turns a Date into the ISO string which a struct stores for a datetime field.
    return isDeepStrictEqual(toJsonValue(inputValue), toJsonValue(stored));
}

function toJsonValue(value: any) {
    return JSON.parse(JSON.stringify(value ?? null));
}
