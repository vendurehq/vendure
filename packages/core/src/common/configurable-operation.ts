// prettier-ignore
import {
    ConfigArg,
    ConfigArgDefinition,
    ConfigurableOperationDefinition,
    LanguageCode,
    LocalizedString,
    Maybe,
    StringFieldOption,
} from '@vendure/common/lib/generated-types';
import {
    ConfigArgType,
    DefaultFormComponentConfig,
    ID,
    UiComponentConfig,
} from '@vendure/common/lib/shared-types';
import { assertNever } from '@vendure/common/lib/shared-utils';

import { RequestContext } from '../api/common/request-context';
import type { EncryptionStrategy } from '../config/system/encryption-strategy';

import { CONFIGURABLE_OPERATION_TRANSLATOR, DEFAULT_LANGUAGE_CODE } from './constants';
import { InternalServerError } from './error/errors';
import { Injector } from './injector';
import { InjectableStrategy } from './types/injectable-strategy';

/**
 * @description
 * An array of string values in a given {@link LanguageCode}, used to define human-readable string values.
 * The `ui` property can be used in conjunction with the Vendure Admin UI to specify a custom form input
 * component.
 *
 * @example
 * ```ts
 * const title: LocalizedStringArray = [
 *   { languageCode: LanguageCode.en, value: 'English Title' },
 *   { languageCode: LanguageCode.de, value: 'German Title' },
 *   { languageCode: LanguageCode.zh, value: 'Chinese Title' },
 * ]
 * ```
 *
 * @docsCategory ConfigurableOperationDef
 */
export type LocalizedStringArray = Array<Omit<LocalizedString, '__typename'>>;

/**
 * @description
 * The registries into which a {@link ConfigurableOperationDef} may be placed. A `code` is only
 * unique within a single registry — `buy_x_get_y_free`, for instance, is used by both a
 * PromotionCondition and a PromotionAction — so the registry name forms part of the key under
 * which translated strings are looked up.
 *
 * @docsCategory ConfigurableOperationDef
 * @since 3.8.0
 */
export type ConfigurableOperationDefType =
    | 'CollectionFilter'
    | 'EntityDuplicator'
    | 'FulfillmentHandler'
    | 'PaymentMethodEligibilityChecker'
    | 'PaymentMethodHandler'
    | 'PromotionAction'
    | 'PromotionCondition'
    | 'ShippingCalculator'
    | 'ShippingEligibilityChecker';

/**
 * @description
 * Supplies translations for {@link ConfigurableOperationDef} descriptions and arg labels from the
 * server-side message catalogs. Implemented by the `I18nService` and provided under the
 * `CONFIGURABLE_OPERATION_TRANSLATOR` token.
 *
 * @docsCategory ConfigurableOperationDef
 * @since 3.8.0
 */
export interface ConfigurableOperationTranslator {
    /**
     * @description
     * Returns the string stored at the given path within the `configurableOperation` namespace of
     * the catalog for `languageCode`, or `undefined` if there is no entry there. The value is
     * returned verbatim, without ICU formatting, since operation descriptions contain
     * `{ argName }` placeholders which are interpolated by the client.
     */
    getConfigurableOperationTranslation(languageCode: string, keyPath: string[]): string | undefined;
}

/**
 * @description
 * A single translatable string belonging to a {@link ConfigurableOperationDef}, as returned by
 * {@link ConfigurableOperationDef.getTranslationKeys}.
 *
 * @docsCategory ConfigurableOperationDef
 * @since 3.8.0
 */
export interface ConfigurableOperationTranslationKey {
    /**
     * @description
     * The path to this string within the `configurableOperation` namespace of a message catalog.
     */
    keyPath: string[];
    /**
     * @description
     * The string as defined inline on the operation, in the default (English) language.
     */
    sourceValue?: string;
}

export interface ConfigArgCommonDef<T extends ConfigArgType> {
    type: T;
    required?: boolean;
    defaultValue?: ConfigArgTypeToTsType<T>;
    list?: boolean;
    label?: LocalizedStringArray;
    description?: LocalizedStringArray;
    ui?: UiComponentConfig<string>;
    /**
     * @description
     * If set to `true`, the value of this arg is encrypted at rest using the configured
     * {@link EncryptionStrategy}, and is only returned in decrypted form via the API to users
     * permitted by the {@link SecretAccessStrategy} (by default, those with the `ReadSecret`
     * permission). Other users receive a redaction placeholder. Only supported on `string` args.
     *
     * @since 3.8.0
     * @default false
     */
    secret?: boolean;
}

export type ConfigArgListDef<
    T extends ConfigArgType,
    C extends ConfigArgCommonDef<T> = ConfigArgCommonDef<T>,
> = C & { list: true };

export type WithArgConfig<T> = {
    config?: T;
};

export type StringArgConfig = WithArgConfig<{
    options?: Maybe<StringFieldOption[]>;
}>;
export type IntArgConfig = WithArgConfig<{
    inputType?: 'default' | 'percentage' | 'money';
}>;

export type ConfigArgDef<T extends ConfigArgType> = T extends 'string'
    ? ConfigArgCommonDef<'string'> & StringArgConfig
    : T extends 'int'
    ? ConfigArgCommonDef<'int'> & IntArgConfig
    : ConfigArgCommonDef<T> & WithArgConfig<never>;

/**
 * @description
 * A object which defines the configurable arguments which may be passed to
 * functions in those classes which implement the {@link ConfigurableOperationDef} interface.
 *
 * ## Data types
 * Each argument has a data type, which must be one of {@link ConfigArgType}.
 *
 * @example
 * ```ts
 * {
 *   apiKey: { type: 'string' },
 *   maxRetries: { type: 'int' },
 *   logErrors: { type: 'boolean' },
 * }
 * ```
 *
 * ## Lists
 * Setting the `list` property to `true` will make the argument into an array of the specified
 * data type. For example, if you want to store an array of strings:
 *
 * @example
 * ```ts
 * {
 *   aliases: {
 *     type: 'string',
 *     list: true,
 *   },
 * }
 *```
 * In the Admin UI, this will be rendered as an orderable list of string inputs.
 *
 * ## UI Component
 * The `ui` field allows you to specify a specific input component to be used in the Admin UI.
 * When not set, a default input component is used appropriate to the data type.
 *
 * @example
 * ```ts
 * {
 *   operator: {
 *     type: 'string',
 *     ui: {
 *       component: 'select-form-input',
 *       options: [
 *         { value: 'startsWith' },
 *         { value: 'endsWith' },
 *         { value: 'contains' },
 *         { value: 'doesNotContain' },
 *       ],
 *     },
 *   },
 *   secretKey: {
 *     type: 'string',
 *     ui: { component: 'password-form-input' },
 *   },
 * }
 * ```
 * The available components as well as their configuration options can be found in the {@link DefaultFormConfigHash} docs.
 * Custom UI components may also be defined via an Admin UI extension using the `registerFormInputComponent()` function
 * which is exported from `@vendure/admin-ui/core`.
 *
 * @docsCategory ConfigurableOperationDef
 */
export type ConfigArgs = {
    [name: string]: ConfigArgDef<ConfigArgType>;
};

/**
 * Represents the ConfigArgs once they have been coerced into JavaScript values for use
 * in business logic.
 */
export type ConfigArgValues<T extends ConfigArgs> = {
    [K in keyof T]: ConfigArgDefToType<T[K]>;
};

/**
 * Converts a ConfigArgDef to a TS type, e.g:
 *
 * ConfigArgListDef<'datetime'> -> Date[]
 * ConfigArgDef<'boolean'> -> boolean
 */
export type ConfigArgDefToType<D extends ConfigArgDef<ConfigArgType>> = D extends ConfigArgListDef<
    'int' | 'float'
>
    ? number[]
    : D extends ConfigArgDef<'int' | 'float'>
    ? number
    : D extends ConfigArgListDef<'datetime'>
    ? Date[]
    : D extends ConfigArgDef<'datetime'>
    ? Date
    : D extends ConfigArgListDef<'boolean'>
    ? boolean[]
    : D extends ConfigArgDef<'boolean'>
    ? boolean
    : D extends ConfigArgListDef<'ID'>
    ? ID[]
    : D extends ConfigArgDef<'ID'>
    ? ID
    : D extends ConfigArgListDef<'string'>
    ? string[]
    : string;

/**
 * Converts a ConfigArgType to a TypeScript type
 *
 * ConfigArgTypeToTsType<'int'> -> number
 */
export type ConfigArgTypeToTsType<T extends ConfigArgType> = T extends 'string'
    ? string
    : T extends 'int'
    ? number
    : T extends 'float'
    ? number
    : T extends 'boolean'
    ? boolean
    : T extends 'datetime'
    ? Date
    : ID;

/**
 * Converts a TS type to a ConfigArgDef, e.g:
 *
 * Date[] -> ConfigArgListDef<'datetime'>
 * boolean -> ConfigArgDef<'boolean'>
 */
export type TypeToConfigArgDef<T extends ConfigArgDefToType<any>> = T extends number
    ? ConfigArgDef<'int' | 'float'>
    : T extends number[]
    ? ConfigArgListDef<'int' | 'float'>
    : T extends Date[]
    ? ConfigArgListDef<'datetime'>
    : T extends Date
    ? ConfigArgDef<'datetime'>
    : T extends boolean[]
    ? ConfigArgListDef<'boolean'>
    : T extends boolean
    ? ConfigArgDef<'boolean'>
    : T extends string[]
    ? ConfigArgListDef<'string'>
    : T extends string
    ? ConfigArgDef<'string'>
    : T extends ID[]
    ? ConfigArgListDef<'ID'>
    : ConfigArgDef<'ID'>;

/**
 * @description
 * Common configuration options used when creating a new instance of a
 * {@link ConfigurableOperationDef} (
 *
 * @docsCategory ConfigurableOperationDef
 */
export interface ConfigurableOperationDefOptions<T extends ConfigArgs> extends InjectableStrategy {
    /**
     * @description
     * A unique code used to identify this operation.
     */
    code: string;
    /**
     * @description
     * Optional provider-specific arguments which, when specified, are
     * editable in the admin-ui. For example, args could be used to store an API key
     * for a payment provider service.
     *
     * @example
     * ```ts
     * args: {
     *   apiKey: { type: 'string' },
     * }
     * ```
     *
     * See {@link ConfigArgs} for available configuration options.
     */
    args: T;
    /**
     * @description
     * A human-readable description for the operation method.
     */
    description: LocalizedStringArray;
}

/**
 * @description
 * A ConfigurableOperationDef is a special type of object used extensively by Vendure to define
 * code blocks which have arguments which are configurable at run-time by the administrator.
 *
 * This is the mechanism used by:
 *
 * * {@link CollectionFilter}
 * * {@link PaymentMethodHandler}
 * * {@link PromotionAction}
 * * {@link PromotionCondition}
 * * {@link ShippingCalculator}
 * * {@link ShippingEligibilityChecker}
 *
 * Any class which extends ConfigurableOperationDef works in the same way: it takes a
 * config object as the constructor argument. That config object extends the {@link ConfigurableOperationDefOptions}
 * interface and typically adds some kind of business logic function to it.
 *
 * For example, in the case of `ShippingEligibilityChecker`,
 * it adds the `check()` function to the config object which defines the logic for checking whether an Order is eligible
 * for a particular ShippingMethod.
 *
 * ## The `args` property
 *
 * The key feature of the ConfigurableOperationDef is the `args` property. This is where we define those
 * arguments that are exposed via the Admin UI as data input components. This allows their values to
 * be set at run-time by the Administrator. Those values can then be accessed in the business logic
 * of the operation.
 *
 * The data type of the args can be one of {@link ConfigArgType}, and the configuration is further explained in
 * the docs of {@link ConfigArgs}.
 *
 * ## Dependency Injection
 * If your business logic relies on injectable providers, such as the `TransactionalConnection` object, or any of the
 * internal Vendure services or those defined in a plugin, you can inject them by using the config object's
 * `init()` method, which exposes the {@link Injector}.
 *
 * Here's an example of a ShippingCalculator that injects a service which has been defined in a plugin:
 *
 * @example
 * ```ts
 * import { Injector, ShippingCalculator } from '\@vendure/core';
 * import { ShippingRatesService } from './shipping-rates.service';
 *
 * // We keep reference to our injected service by keeping it
 * // in the top-level scope of the file.
 * let shippingRatesService: ShippingRatesService;
 *
 * export const customShippingCalculator = new ShippingCalculator({
 *   code: 'custom-shipping-calculator',
 *   description: [],
 *   args: {},
 *
 *   init(injector: Injector) {
 *     // The init function is called during bootstrap, and allows
 *     // us to inject any providers we need.
 *     shippingRatesService = injector.get(ShippingRatesService);
 *   },
 *
 *   calculate: async (order, args) => {
 *     // We can now use the injected provider in the business logic.
 *     const { price, priceWithTax } = await shippingRatesService.getRate({
 *       destination: order.shippingAddress,
 *       contents: order.lines,
 *     });
 *
 *     return {
 *       price,
 *       priceWithTax,
 *     };
 *   },
 * });
 * ```
 *
 * ## Translations
 *
 * The `description` of the operation, plus the `label` and `description` of each arg, may be
 * defined inline as a {@link LocalizedStringArray}. They may also be supplied from the server-side
 * message catalogs, under the `configurableOperation` namespace, using keys of the form:
 *
 * ```text
 * configurableOperation.<type>.<code>.description
 * configurableOperation.<type>.<code>.args.<argName>.label
 * configurableOperation.<type>.<code>.args.<argName>.description
 * configurableOperation.<type>.<code>.args.<argName>.options.<optionValue>.label
 * ```
 *
 * where `<type>` is one of {@link ConfigurableOperationDefType}. Call
 * {@link ConfigurableOperationDef.getTranslationKeys} to see the exact keys for a given operation.
 * Catalog entries take precedence over the inline arrays for the same language, which means the
 * strings of a third-party operation can be overridden by registering translations for its keys
 * via `I18nService.addTranslation()`. A key which does not match any operation is simply never
 * read, so a typo produces no error — the inline string is used instead.
 *
 * The description and the arg labels are resolved to a single string before being sent, in the
 * language requested by the client. Select option labels are the exception: they are sent as a
 * full {@link LocalizedStringArray} with the catalog translation merged in, because the Admin UI
 * resolves them against the administrator's display language, which is a separate setting from the
 * content language sent with the request.
 *
 * @docsCategory ConfigurableOperationDef
 */
export class ConfigurableOperationDef<T extends ConfigArgs = ConfigArgs> {
    private defType?: ConfigurableOperationDefType;
    private translator?: ConfigurableOperationTranslator;

    get code(): string {
        return this.options.code;
    }
    get args(): T {
        return this.options.args;
    }
    get description(): LocalizedStringArray {
        return this.options.description;
    }
    protected encryptionStrategy?: EncryptionStrategy;

    constructor(protected options: ConfigurableOperationDefOptions<T>) {}

    async init(injector: Injector) {
        this.translator = injector.get<ConfigurableOperationTranslator>(CONFIGURABLE_OPERATION_TRANSLATOR);
        if (typeof this.options.init === 'function') {
            await this.options.init(injector);
        }
    }

    /**
     * @internal
     * Sets the registry this operation is part of, which together with the `code` forms the key
     * prefix under which its translated strings are looked up. Called during bootstrap by the
     * ConfigModule, which holds the registries. An operation with no defType resolves its strings
     * from the inline arrays only.
     */
    setDefType(defType: ConfigurableOperationDefType) {
        this.defType = defType;
    }

    /**
     * @internal
     * Sets the EncryptionStrategy used to decrypt the values of any `secret` args. Called during
     * bootstrap by the ConfigModule, where the ConfigService is available (avoiding a circular
     * dependency in this module).
     */
    setEncryptionStrategy(encryptionStrategy: EncryptionStrategy | undefined) {
        this.encryptionStrategy = encryptionStrategy;
    }
    async destroy() {
        if (typeof this.options.destroy === 'function') {
            await this.options.destroy();
        }
    }

    /**
     * @description
     * Convert a ConfigurableOperationDef into a ConfigurableOperationDefinition object, typically
     * so that it can be sent via the API.
     */
    toGraphQlType(ctx: RequestContext): ConfigurableOperationDefinition {
        return {
            code: this.code,
            description: this.localizeString(this.description, ctx, ['description']) ?? '',
            args: Object.entries(this.args).map(
                ([name, arg]) =>
                    ({
                        name,
                        type: arg.type,
                        list: arg.list ?? false,
                        required: arg.required ?? true,
                        defaultValue: arg.defaultValue,
                        ui: this.localizeUiOptions(arg.ui, ctx, name),
                        secret: arg.secret ?? false,
                        label: this.localizeString(arg.label, ctx, ['args', name, 'label']),
                        description: this.localizeString(arg.description, ctx, [
                            'args',
                            name,
                            'description',
                        ]),
                    } as Required<ConfigArgDefinition>),
            ),
        };
    }

    /**
     * @description
     * Lists every string on this operation which can be translated via the message catalogs,
     * along with the paths under which the translations must be stored in the
     * `configurableOperation` namespace. Intended for translation tooling and for plugin authors
     * checking which keys they need to define.
     *
     * @since 3.8.0
     */
    getTranslationKeys(): ConfigurableOperationTranslationKey[] {
        if (!this.defType) {
            return [];
        }
        const prefix = [this.defType, this.code];
        const sourceOf = (strings: LocalizedStringArray | undefined) =>
            strings?.find(x => x.languageCode === DEFAULT_LANGUAGE_CODE)?.value;
        const keys: ConfigurableOperationTranslationKey[] = [
            { keyPath: [...prefix, 'description'], sourceValue: sourceOf(this.description) },
        ];
        for (const [name, arg] of Object.entries(this.args)) {
            keys.push({ keyPath: [...prefix, 'args', name, 'label'], sourceValue: sourceOf(arg.label) });
            keys.push({
                keyPath: [...prefix, 'args', name, 'description'],
                sourceValue: sourceOf(arg.description),
            });
            for (const option of getUiOptions(arg.ui)) {
                keys.push({
                    keyPath: [...prefix, 'args', name, 'options', option.value, 'label'],
                    sourceValue: sourceOf(option.label),
                });
            }
        }
        return keys;
    }

    /**
     * Resolves a single localized string, checking the message catalogs before the inline
     * definition for each language in turn. Preferring the catalog allows a user to override the
     * strings of a third-party operation without forking it, while checking both sources per
     * language (rather than exhausting the catalogs first) means an operation which ships only
     * inline translations still resolves to its own language rather than to the English catalog.
     */
    private localizeString(
        inline: LocalizedStringArray | undefined,
        ctx: RequestContext,
        keyPath: string[],
    ): string | undefined {
        for (const languageCode of this.languagePreference(ctx)) {
            // Truthiness, not a null check: an empty catalog entry means "not translated yet", the
            // same as it does in the .po catalogs, so it falls through rather than blanking the
            // string. A catalog therefore cannot be used to remove an inline string.
            const fromCatalog = this.lookupCatalog(languageCode, keyPath);
            if (fromCatalog) {
                return fromCatalog;
            }
            const fromInline = inline?.find(x => x.languageCode === languageCode);
            if (fromInline) {
                return fromInline.value;
            }
        }
        return inline?.[0]?.value;
    }

    /**
     * The languages to try, in order, when resolving a string which the administrator reads.
     *
     * These strings describe the operation itself rather than the data it acts on, so they follow
     * the language the client asked to read in its `Accept-Language` header. `ctx.languageCode`
     * selects a translation of the data, so it comes after that, and is what a client which sends
     * no header resolves against.
     */
    private languagePreference(ctx: RequestContext): LanguageCode[] {
        return [
            // Defensive: a hand-rolled RequestContext, as plugin tests often use, has no such field.
            ...(ctx.acceptedLanguageCodes ?? []),
            ctx.languageCode,
            ctx.channel.defaultLanguageCode,
            DEFAULT_LANGUAGE_CODE,
        ];
    }

    /** Reads a single string out of the message catalogs, or undefined if the key is not set. */
    private lookupCatalog(languageCode: LanguageCode, keyPath: string[]): string | undefined {
        if (!this.defType) {
            return undefined;
        }
        return this.translator?.getConfigurableOperationTranslation(languageCode, [
            this.defType,
            this.code,
            ...keyPath,
        ]);
    }

    /**
     * Merges any catalog translation of a select option's label into the arg's `ui` config.
     *
     * Option labels stay as a full LocalizedStringArray rather than being resolved to one string
     * like the operation description and the arg labels are, because the Admin UI picks the option
     * label itself.
     *
     * The merged entry carries the language code the client asked for. Every client looks up its
     * own display language and falls back to the first entry in the array when it finds no exact
     * match, so a match reached by truncating `pt_BR` to `pt`, or one taken from the channel
     * default or English further down the list, would be passed over if it were filed under the
     * code the catalog entry was found for.
     *
     * The result is a copy, and the original is returned untouched when there is nothing to merge.
     * `ui` belongs to the long-lived config object shared by every request, so merging in place
     * would leak one request's translations into all the requests that follow it.
     */
    private localizeUiOptions(
        ui: UiComponentConfig<string> | undefined,
        ctx: RequestContext,
        argName: string,
    ): UiComponentConfig<string> | undefined {
        const options = getUiOptions(ui);
        if (!options.length) {
            return ui;
        }
        const requestedLanguage = ctx.acceptedLanguageCodes?.[0] ?? ctx.languageCode;
        let merged = false;
        const localized = options.map(option => {
            for (const languageCode of this.languagePreference(ctx)) {
                const fromCatalog = this.lookupCatalog(languageCode, [
                    'args',
                    argName,
                    'options',
                    option.value,
                    'label',
                ]);
                if (!fromCatalog) {
                    continue;
                }
                merged = true;
                const others = (option.label ?? []).filter(x => x.languageCode !== requestedLanguage);
                return {
                    ...option,
                    label: [...others, { languageCode: requestedLanguage, value: fromCatalog }],
                };
            }
            return option;
        });
        return merged ? { ...(ui as any), options: localized } : ui;
    }

    /**
     * @description
     * Coverts an array of ConfigArgs into a hash object:
     *
     * from:
     * `[{ name: 'foo', type: 'string', value: 'bar'}]`
     *
     * to:
     * `{ foo: 'bar' }`
     **/
    protected argsArrayToHash(args: ConfigArg[]): ConfigArgValues<T> {
        const output: ConfigArgValues<T> = {} as any;
        for (const arg of args) {
            if (arg && arg.value != null && this.args[arg.name] != null) {
                const argDef = this.args[arg.name];
                // Only values produced by encrypt() may be passed to decrypt(); a legacy plaintext
                // secret value is used as-is.
                const value =
                    argDef.secret && this.encryptionStrategy?.isEncrypted(arg.value)
                        ? this.encryptionStrategy.decrypt(arg.value)
                        : arg.value;
                output[arg.name as keyof ConfigArgValues<T>] = coerceValueToType<T>(
                    value,
                    argDef.type,
                    argDef.list || false,
                );
            }
        }
        return output;
    }
}

/**
 * The `select-form-input` component is the only one which defines localizable option labels, but
 * the `ui` config of a custom component is untyped, so the options are read defensively.
 */
function getUiOptions(
    ui: UiComponentConfig<string> | undefined,
): Array<{ value: string; label?: LocalizedStringArray }> {
    const options = (ui as any)?.options;
    return Array.isArray(options) ? options : [];
}

function coerceValueToType<T extends ConfigArgs>(
    value: string,
    type: ConfigArgType,
    isList: boolean,
): ConfigArgValues<T>[keyof T] {
    if (isList) {
        try {
            return (JSON.parse(value) as string[]).map(v => coerceValueToType(v, type, false)) as any;
        } catch (err: any) {
            throw new InternalServerError(
                `Could not parse list value "${value}": ` + JSON.stringify(err.message),
            );
        }
    }
    switch (type) {
        case 'string':
            return value as any;
        case 'int':
            return Number.parseInt(value || '', 10) as any;
        case 'float':
            return Number.parseFloat(value || '') as any;
        case 'datetime':
            return Date.parse(value || '') as any;
        case 'boolean':
            return !!(value && (value.toLowerCase() === 'true' || value === '1')) as any;
        case 'ID':
            return value as any;
        default:
            assertNever(type);
    }
}
