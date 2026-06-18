export type Omit<T, K extends keyof T> = Pick<T, Exclude<keyof T, K>>;

declare const File: any;

/**
 * Type-safe omit function - returns a new object which omits the specified keys.
 */
export function omit<T extends object, K extends keyof T>(obj: T, keysToOmit: K[]): Omit<T, K>;
export function omit<T extends object | any[], K extends keyof T>(
    obj: T,
    keysToOmit: string[],
    recursive: boolean,
): T;
export function omit<T, K extends keyof T>(obj: T, keysToOmit: string[], recursive: boolean = false): T {
    if ((recursive && !isObject(obj)) || isFileObject(obj)) {
        return obj;
    }

    if (recursive && Array.isArray(obj)) {
        return obj.map((item: any) => omit(item, keysToOmit, true)) as T;
    }

    return Object.keys(obj as object).reduce((output: any, key) => {
        if (keysToOmit.includes(key)) {
            return output;
        }
        if (recursive) {
            return { ...output, [key]: omit((obj as any)[key], keysToOmit, true) };
        }
        return { ...output, [key]: (obj as any)[key] };
    }, {} as Omit<T, K>);
}

function isObject(input: any): input is object {
    return typeof input === 'object' && input !== null;
}

/**
 * When running in the Node environment, there is no native File object.
 */
function isFileObject(input: any): boolean {
    if (typeof File === 'undefined') {
        return false;
    } else {
        return input instanceof File;
    }
}
