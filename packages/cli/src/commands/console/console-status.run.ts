import { CommandContext, fail } from '@vendure/common/lib/command';

import { consoleErrors } from './console.errors.js';
import { ConsoleStatus, readConsoleStatus } from './console.js';
import { DirInput, StatusOutput } from './console.schema.js';
import { resolveProjectRoot } from './project-link-manifest.js';

const LOGIN_STATUS_HINT = 'Login: run vendure auth status';

/** Reads the Project Link of the project, without calling Console. */
export async function run(input: DirInput, ctx: CommandContext) {
    let status: ConsoleStatus;
    try {
        status = readConsoleStatus(resolveProjectRoot(ctx.cwd, input.dir), process.env);
    } catch (error) {
        return fail(consoleErrors.statusFailed, {
            message: error instanceof Error ? error.message : String(error),
        });
    }
    if (status.kind === 'invalid') {
        return fail(consoleErrors.manifestInvalid, {
            manifestPath: status.manifestPath,
            reason: status.reason,
        });
    }
    return statusOutput(status);
}

/** The output of `vendure console status` for a manifest that is there and valid, or missing. */
export function statusOutput(status: Exclude<ConsoleStatus, { kind: 'invalid' }>): StatusOutput {
    if (status.kind === 'missing') {
        return { linked: false, manifestPath: status.manifestPath };
    }
    const { manifest, telemetry } = status;
    return {
        linked: true,
        manifestPath: status.manifestPath,
        project: { id: manifest.project.id, name: manifest.project.name },
        account: { id: manifest.account.id, name: manifest.account.name },
        link: { id: manifest.link.id, protocolVersion: manifest.link.protocolVersion },
        schemaVersion: manifest.schemaVersion,
        consoleUrl: status.consoleUrl,
        consoleApiUrl: status.apiUrl,
        telemetry,
    };
}

/** The Project Link only. `vendure auth status` reports the login. */
export function render(output: StatusOutput): string {
    if (!output.linked) {
        return `Project: Not linked\nManifest: ${output.manifestPath}\n${LOGIN_STATUS_HINT}`;
    }
    const { telemetry } = output;
    return [
        `Account: ${output.account.name} (${output.account.id})`,
        `Project: ${output.project.name} (${output.project.id})`,
        `Schema version: ${output.schemaVersion}`,
        `Protocol version: ${output.link.protocolVersion}`,
        `Link: ${output.link.id}`,
        `Console: ${output.consoleUrl}`,
        `Console API: ${output.consoleApiUrl}`,
        `Manifest: ${output.manifestPath}`,
        telemetry.state === 'off'
            ? 'Telemetry: off (VENDURE_DISABLE_TELEMETRY)'
            : telemetry.state === 'attributed'
              ? `Telemetry: attributed to ${output.project.name} (installation ${String(telemetry.installationId)})`
              : 'Telemetry: not attributed. Run vendure console unlink, then vendure console link, to attribute it.',
        LOGIN_STATUS_HINT,
    ].join('\n');
}
