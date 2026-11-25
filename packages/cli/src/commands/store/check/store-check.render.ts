import pc from 'picocolors';

import { StoreCheckFinding, StoreCheckOutput } from './store-check.schema.js';

/**
 * One block per finding: its severity, code and message, then each fix as the MCP admin tool call
 * that makes it, and the Dashboard page that shows it.
 */
export function render(report: StoreCheckOutput): string {
    const errors = report.findings.filter(f => f.severity === 'ERROR').length;
    const warnings = report.findings.length - errors;
    const summary = report.ready
        ? pc.green(`The store can take orders.${warnings ? ` ${count(warnings, 'warning')}.` : ''}`)
        : pc.red(
              `The store cannot take orders: ${count(errors, 'error')}` +
                  `${warnings ? `, ${count(warnings, 'warning')}` : ''}.`,
          );
    const blocks = report.findings.map(finding => renderFinding(finding, report.dashboard));
    return [...blocks, summary].join('\n\n');
}

function renderFinding(finding: StoreCheckFinding, dashboard: string | undefined): string {
    const label = finding.severity === 'ERROR' ? pc.red('error') : pc.yellow('warning');
    const lines = [`${label} ${pc.dim(finding.code)}`, `  ${finding.message}`];
    for (const fix of finding.fixes) {
        lines.push(`  ${pc.cyan('fix')} ${fix.description}`);
        lines.push(`      ${fix.path.join(' ')} ${JSON.stringify(fix.input)}`);
    }
    if (finding.dashboardUrl) {
        lines.push(`  ${pc.cyan('dashboard')} ${dashboardLink(finding.dashboardUrl, dashboard)}`);
    }
    return lines.join('\n');
}

function dashboardLink(path: string, dashboard: string | undefined): string {
    return dashboard ? `${dashboard.replace(/\/$/, '')}${path}` : path;
}

function count(n: number, noun: string): string {
    return `${n} ${noun}${n === 1 ? '' : 's'}`;
}
