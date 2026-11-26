// The project's own config resolver. The config is not declared in the app's source: a shared
// library builds it at run time, and the app imports it through a path mapping of the base tsconfig.
import { getVendureConfig } from '@example/shared-config';

export async function resolve() {
    return getVendureConfig();
}
