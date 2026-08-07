import { Injectable } from '@nestjs/common';
import { ConfigurableOperation, ConfigurableOperationInput } from '@vendure/common/lib/generated-types';
import { isForeignSecretPlaceholder, REDACTED_SECRET_PLACEHOLDER } from '@vendure/common/lib/shared-constants';

import { ConfigurableOperationDef } from '../../../common/configurable-operation';
import { InternalServerError, UserInputError } from '../../../common/error/errors';
import { ConfigService } from '../../../config/config.service';
import {
    ConfigDefType,
    ConfigDefTypeMap,
    getConfigurableOperationDefinitions,
} from '../../../config/configurable-operation-registry';

export type { ConfigDefType, ConfigDefTypeMap };

// A NUL separator that cannot appear in a code or arg name, so the two parts are unambiguous.
function secretArgKey(code: string, argName: string): string {
    return `${code}\0${argName}`;
}

/**
 * This helper class provides methods relating to ConfigurableOperationDef instances.
 */
@Injectable()
export class ConfigArgService {
    private readonly definitionsByType: { [K in ConfigDefType]: Array<ConfigDefTypeMap[K]> };
    /**
     * The `code\0argName` of every registered `secret` config arg, built once so that redaction can
     * look up "is this arg secret" in O(1) per arg rather than scanning the registries per response.
     * Operation codes are expected to be unique across operation types (the framework convention); if
     * two types share a code and one declares a secret arg by the same name, the other is treated as
     * secret too, which fails closed (redacted) rather than open.
     */
    private readonly secretArgKeys = new Set<string>();

    constructor(private configService: ConfigService) {
        this.definitionsByType = getConfigurableOperationDefinitions(this.configService);
        for (const defs of Object.values(this.definitionsByType)) {
            for (const def of defs) {
                for (const [argName, argDef] of Object.entries(def.args)) {
                    if ((argDef as { secret?: boolean }).secret === true) {
                        this.secretArgKeys.add(secretArgKey(def.code, argName));
                    }
                }
            }
        }
    }

    getDefinitions<T extends ConfigDefType>(defType: T): Array<ConfigDefTypeMap[T]> {
        return this.definitionsByType[defType] as Array<ConfigDefTypeMap[T]>;
    }

    /**
     * Returns `true` if a registered operation with the given code defines a `secret` arg with the
     * given name. Used to redact secret args on read based on their definition rather than on whether
     * the stored value happens to look encrypted, so that a `secret` arg holding a legacy plaintext
     * value (e.g. written before the field was marked secret) is still redacted rather than leaked.
     */
    hasSecretArg(code: string, argName: string): boolean {
        return this.secretArgKeys.size > 0 && this.secretArgKeys.has(secretArgKey(code, argName));
    }

    getByCode<T extends ConfigDefType>(defType: T, code: string): ConfigDefTypeMap[T] {
        const defsOfType = this.getDefinitions(defType);
        const match = defsOfType.find(def => def.code === code);
        if (!match) {
            throw new UserInputError('error.no-configurable-operation-def-with-code-found', {
                code,
                type: defType,
            });
        }
        return match;
    }

    /**
     * Parses and validates the input to a ConfigurableOperation.
     *
     * When the operation has `secret` args, their values are encrypted at rest. If the incoming
     * value is the redaction placeholder (i.e. the admin did not re-enter the secret), the previously
     * stored value is preserved; on a create there is nothing to preserve, so the placeholder is
     * rejected.
     */
    parseInput(
        defType: ConfigDefType,
        input: ConfigurableOperationInput,
        previous?: ConfigurableOperation,
    ): ConfigurableOperation {
        const match = this.getByCode(defType, input.code);
        this.validateRequiredFields(input, match);
        const orderedArgs = this.orderArgsToMatchDef(match, input.arguments);
        const args = this.processSecretArgs(match, orderedArgs, previous);
        return {
            code: input.code,
            args,
        };
    }

    /**
     * Parses input for an operation that is run immediately and never persisted, such as a collection
     * variant preview or a shipping-method test. Unlike {@link parseInput} it does not encrypt `secret`
     * args or resolve the redaction placeholder: the caller-supplied values are validated, ordered and
     * used as-is. This avoids the placeholder-preservation logic (which would otherwise reject a
     * resubmitted placeholder), at the cost that such a transient operation cannot see the stored
     * secret of an existing entity — the caller must supply a real value to exercise it.
     */
    parseInputForExecution(
        defType: ConfigDefType,
        input: ConfigurableOperationInput,
    ): ConfigurableOperation {
        const match = this.getByCode(defType, input.code);
        this.validateRequiredFields(input, match);
        return {
            code: input.code,
            args: this.orderArgsToMatchDef(match, input.arguments),
        };
    }

    /**
     * Parses a list of ConfigurableOperation inputs, matching each input to its previously-stored
     * value so that `secret` args submitted as the redaction placeholder are preserved. Matching is
     * by code and by position among entries that share a code, so that duplicate operations (e.g.
     * two promotion conditions with the same code, or two collection filters) each preserve their
     * own stored value rather than all matching the first entry.
     */
    parseInputList(
        defType: ConfigDefType,
        inputs: ConfigurableOperationInput[],
        previous: ConfigurableOperation[] = [],
    ): ConfigurableOperation[] {
        const remainingPrevious = [...previous];
        return inputs.map(input => {
            const matchIndex = remainingPrevious.findIndex(p => p.code === input.code);
            const matched = matchIndex === -1 ? undefined : remainingPrevious.splice(matchIndex, 1)[0];
            return this.parseInput(defType, input, matched);
        });
    }

    /**
     * Encrypts the values of any `secret` args, preserving the previously-stored (encrypted) value
     * when the redaction placeholder is submitted.
     */
    private processSecretArgs(
        def: ConfigurableOperationDef,
        args: ConfigurableOperation['args'],
        previous?: ConfigurableOperation,
    ): ConfigurableOperation['args'] {
        return args.map(arg => {
            const argDef = def.args[arg.name];
            if (!argDef?.secret) {
                return arg;
            }
            if (arg.value === REDACTED_SECRET_PLACEHOLDER) {
                const previousArg = previous?.args?.find(a => a.name === arg.name);
                if (!previousArg) {
                    throw new UserInputError('error.secret-value-required', { name: arg.name });
                }
                // Preserve the existing stored (already-encrypted) value.
                return { name: arg.name, value: previousArg.value };
            }
            if (isForeignSecretPlaceholder(arg.value)) {
                // A placeholder from a different version must not be encrypted as a real value.
                throw new UserInputError('error.secret-value-required', { name: arg.name });
            }
            if (arg.value == null || arg.value === '') {
                return arg;
            }
            const encryptionStrategy = this.configService.systemOptions.encryptionStrategy;
            if (!encryptionStrategy) {
                throw new InternalServerError(
                    'A `secret` config arg was used, but no EncryptionStrategy is configured.',
                );
            }
            return { name: arg.name, value: encryptionStrategy.encrypt(arg.value) };
        });
    }

    private orderArgsToMatchDef<T extends ConfigDefType>(
        def: ConfigDefTypeMap[T],
        args: ConfigurableOperation['args'],
    ) {
        const output: ConfigurableOperation['args'] = [];
        for (const name of Object.keys(def.args)) {
            const match = args.find(arg => arg.name === name);
            if (match) {
                output.push(match);
            }
        }
        return output;
    }

    private validateRequiredFields(input: ConfigurableOperationInput, def: ConfigurableOperationDef) {
        for (const [name, argDef] of Object.entries(def.args)) {
            if (argDef.required) {
                const inputArg = input.arguments.find(a => a.name === name);

                let valid = false;
                try {
                    if (['string', 'ID', 'datetime'].includes(argDef.type)) {
                        valid = !!inputArg && inputArg.value !== '' && inputArg.value != null;
                    } else {
                        valid = !!inputArg && JSON.parse(inputArg.value) != null;
                    }
                } catch (e: any) {
                    // ignore
                }

                if (!valid) {
                    throw new UserInputError('error.configurable-argument-is-required', {
                        name,
                    });
                }
            }
        }
    }
}
