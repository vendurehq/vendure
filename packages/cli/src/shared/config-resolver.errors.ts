import { defineError } from '@vendure/common/lib/command';

/**
 * The config resolver of an enabled package threw, or returned something that is not a config.
 *
 * @since 4.0.0
 */
export const configResolverFailed = defineError<{ plugin: string; message: string }>({
    code: 'config.resolver-failed',
    exit: 1,
    message: ({ plugin, message }) => `The config resolver of ${plugin} failed: ${message}`,
});
