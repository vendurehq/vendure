import { ConfigurableOperationDefFragment } from '@/vdb/graphql/fragments.js';

type ConfigurableOperationArgDef = ConfigurableOperationDefFragment['args'][number];

export function getInitialConfigArgValue(arg: ConfigurableOperationArgDef): string {
    if (arg.list) {
        return arg.defaultValue != null ? JSON.stringify([arg.defaultValue]) : '[]';
    }
    if (arg.defaultValue != null) {
        return arg.defaultValue.toString();
    }
    // Required boolean args render as an off switch by default, so persist the
    // same explicit false value that the UI communicates to validation.
    if (arg.type === 'boolean') {
        return 'false';
    }
    return '';
}
