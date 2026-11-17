/** Compatibility exports for consumers of the existing CLI authentication path. */
export {
    CLI_TOKEN_PATH,
    authorizationCodeGrant,
    cliAuthSearchParams,
    createLoginState,
    createPkceChallenge,
    parseConsoleSession,
    startLoopbackCallback,
} from './authentication';
export type { ConsoleSession, LoopbackCallback, PkceChallenge } from './authentication';
