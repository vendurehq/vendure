import type { Control } from 'react-hook-form';
import type { FieldInfo } from '../document-introspection/get-document-structure.js';

/**
 * The paths of the `@nonBlank` input fields of each generated form, keyed by the form's `control`
 * so that the field wrappers can look them up without extra props. List indices are left out of
 * the paths, e.g. `translations.name`.
 */
const nonBlankPathsByControl = new WeakMap<Control<any>, Set<string>>();

export function setNonBlankFields(control: Control<any>, fields: FieldInfo[]) {
    const paths = new Set<string>();
    const collect = (fieldDefs: FieldInfo[], prefix: string) => {
        for (const field of fieldDefs) {
            const path = prefix + field.name;
            if (field.nonBlank) {
                paths.add(path);
            }
            if (field.typeInfo) {
                collect(field.typeInfo, path + '.');
            }
        }
    };
    collect(fields, '');
    nonBlankPathsByControl.set(control, paths);
}

/**
 * Whether the field at `name` (e.g. `code` or `translations.0.name`) of the form with the given
 * `control` has the `@nonBlank` directive.
 */
export function isNonBlankField(control: Control<any> | undefined, name: string): boolean {
    if (!control) {
        return false;
    }
    const path = name
        .split('.')
        .filter(segment => !/^\d+$/.test(segment))
        .join('.');
    return nonBlankPathsByControl.get(control)?.has(path) ?? false;
}
