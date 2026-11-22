import type { CommandDefinition, CommandNeed } from '@vendure/common/lib/command';

import { formatFix, HostResult } from './host.js';
import { kebab } from './naming.js';

function describeNeed(need: CommandNeed): string[] {
    switch (need.kind) {
        case 'input': {
            const choices = need.choices?.length ? ` One of: ${need.choices.join(', ')}.` : '';
            return [`  --${kebab(need.field)}: ${need.description}.${choices}`];
        }
        case 'consent': {
            const lines = [`  --${kebab(need.consent)} ${need.digest}: ${need.description}`];
            if (need.preview !== undefined) {
                lines.push(
                    ...JSON.stringify(need.preview, null, 2)
                        .split('\n')
                        .map(line => `      ${line}`),
                );
            }
            return lines;
        }
        case 'person':
            return [`  ${need.summary} (${need.action}): ${need.url}`];
    }
}

/**
 * Writes the result of a run for a person: the output on stdout, everything else on stderr. A
 * command's `render()` decides how its output looks. Without one, the output is printed as JSON.
 *
 * `runAgainAs` is the command line to run again after `incomplete`, when the person did not type
 * the command's own path, such as `vendure add -e Review` for `vendure add entity`. The missing
 * flags belong to that command line, not to the one the person typed.
 */
export async function presentForPeople(
    def: CommandDefinition,
    result: HostResult,
    runAgainAs?: { path: string[]; input: Record<string, unknown> },
): Promise<void> {
    const { envelope } = result;
    if (envelope.status === 'ok' || envelope.status === 'failed') {
        if (def.render) {
            const { render } = await def.render();
            const text = render(envelope.output);
            if (typeof text === 'string') {
                process.stdout.write(`${text}\n`);
            }
        } else if (envelope.output !== undefined) {
            process.stdout.write(`${JSON.stringify(envelope.output, null, 2)}\n`);
        }
    } else if (envelope.status === 'incomplete') {
        process.stderr.write(
            runAgainAs
                ? `This command needs more before it can run. Run it as\n  ${formatFix(runAgainAs)}\nwith:\n`
                : 'This command needs more before it can run. Supply:\n',
        );
        for (const need of envelope.needs ?? []) {
            for (const line of describeNeed(need)) {
                process.stderr.write(`${line}\n`);
            }
        }
        if (!runAgainAs) {
            process.stderr.write('Then run the same command again.\n');
        }
    } else if (envelope.error) {
        process.stderr.write(`${envelope.error.message}\n`);
        for (const fix of envelope.error.fixes ?? []) {
            process.stderr.write(`  ${fix.description}: ${formatFix(fix)}\n`);
        }
    }
}
