/**
 * Reports progress from the `console` command and its plugin hooks.
 *
 * @since 3.8.0
 */
export interface ConsoleReporter {
    error(message: string): void;
    info(message: string): void;
    success(message: string): void;
    warn(message: string): void;
    url(value: string): void;
}
