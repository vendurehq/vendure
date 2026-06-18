import { ID } from '@vendure/common/lib/shared-types';

import { LogLevel } from '../../config/logger/vendure-logger';
import { coreEntitiesMap } from '../../entity/entities';
import { I18nError } from '../../i18n/i18n-error';

/**
 * @description
 * This error should be thrown when some unexpected and exceptional case is encountered.
 *
 * @docsCategory errors
 * @docsPage Error Types
 */
export class InternalServerError extends I18nError {
    constructor(message: string, variables: { [key: string]: string | number } = {}) {
        super(message, variables, 'INTERNAL_SERVER_ERROR', LogLevel.Error);
    }
}

/**
 * @description
 * This error should be thrown when user input is not as expected.
 *
 * @docsCategory errors
 * @docsPage Error Types
 */
export class UserInputError extends I18nError {
    constructor(message: string, variables: { [key: string]: string | number } = {}) {
        super(message, variables, 'USER_INPUT_ERROR', LogLevel.Warn);
    }
}

/**
 * @description
 * This error should be thrown when an operation is attempted which is not allowed.
 *
 * @docsCategory errors
 * @docsPage Error Types
 */
export class IllegalOperationError extends I18nError {
    constructor(message: string, variables: { [key: string]: string | number } = {}) {
        super(message, variables, 'ILLEGAL_OPERATION', LogLevel.Warn);
    }
}

/**
 * @description
 * This error should be thrown when the user's authentication credentials do not match.
 *
 * @docsCategory errors
 * @docsPage Error Types
 */
export class UnauthorizedError extends I18nError {
    constructor() {
        super('error.unauthorized', {}, 'UNAUTHORIZED', LogLevel.Info);
    }
}

/**
 * @description
 * This error should be thrown when a user attempts to access a resource which is outside of
 * his or her privileges.
 *
 * @docsCategory errors
 * @docsPage Error Types
 */
export class ForbiddenError extends I18nError {
    constructor(logLevel: LogLevel = LogLevel.Warn) {
        super('error.forbidden', {}, 'FORBIDDEN', logLevel);
    }
}

/**
 * @description
 * This error should be thrown when a {@link Channel} cannot be found based on the provided
 * channel token.
 *
 * @docsCategory errors
 * @docsPage Error Types
 */
export class ChannelNotFoundError extends I18nError {
    constructor(token: string) {
        super('error.channel-not-found', { token }, 'CHANNEL_NOT_FOUND', LogLevel.Info);
    }
}

/**
 * @description
 * This error should be thrown when an entity cannot be found in the database, i.e. no entity of
 * the given entityName (Product, User etc.) exists with the provided id.
 *
 * @docsCategory errors
 * @docsPage Error Types
 */
export class EntityNotFoundError extends I18nError {
    constructor(entityName: keyof typeof coreEntitiesMap | string, id: ID) {
        super('error.entity-with-id-not-found', { entityName, id }, 'ENTITY_NOT_FOUND', LogLevel.Warn);
    }
}
