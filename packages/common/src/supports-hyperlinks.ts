// TERM values of terminals that render OSC 8 hyperlinks but set no TERM_PROGRAM.
const HYPERLINK_TERMS = ['xterm-kitty', 'xterm-ghostty', 'alacritty', 'foot', 'foot-extra'];

/**
 * @description
 * Whether the terminal renders OSC 8 hyperlinks. `FORCE_HYPERLINK` overrides the other checks.
 * Without it, a non-TTY stdout or a CI run gets no hyperlink. The terminal checks follow the
 * `supports-hyperlinks` package, which no Vendure package depends on.
 *
 * Only the default parameters read `process`, so importing this module is safe in a browser.
 */
export function supportsHyperlinks(
    env: Record<string, string | undefined> = process.env,
    isTTY: boolean = process.stdout.isTTY === true,
): boolean {
    if (env.FORCE_HYPERLINK) {
        return parseInt(env.FORCE_HYPERLINK, 10) !== 0;
    }
    if (!isTTY || env.CI || env.TEAMCITY_VERSION) {
        return false;
    }
    if (env.WT_SESSION) {
        return true;
    }
    if (['iTerm.app', 'vscode', 'WezTerm', 'WarpTerminal'].includes(env.TERM_PROGRAM ?? '')) {
        return true;
    }
    if (HYPERLINK_TERMS.includes(env.TERM ?? '')) {
        return true;
    }
    return Number.parseInt(env.VTE_VERSION ?? '', 10) >= 5000;
}
