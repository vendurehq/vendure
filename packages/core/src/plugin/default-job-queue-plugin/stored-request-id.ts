/**
 * The key under which the request ID of a job is stored in the `data` column, so that storing it
 * needs no schema change. The key is added on the way into the table and removed on the way out,
 * so the `data` of a job is what the code which added it passed.
 *
 * Only object data can carry the key. A job whose data is a string, a number or an array loses
 * its request ID when it is stored.
 */
export const STORED_REQUEST_ID_KEY = '__vendureRequestId';

/**
 * Returns the data to store for a job: its data with the request ID added, when the job has one
 * and its data is an object.
 */
// `any`, like the type of the `data` column of a JobRecord.
export function withStoredRequestId(data: any, requestId: string | undefined): any {
    if (requestId === undefined || !isPlainObject(data)) {
        return data;
    }
    return { ...data, [STORED_REQUEST_ID_KEY]: requestId };
}

/**
 * Splits stored data into the data of the job and its request ID.
 */
export function readStoredRequestId(storedData: unknown): { data: unknown; requestId?: string } {
    if (!isPlainObject(storedData) || !(STORED_REQUEST_ID_KEY in storedData)) {
        return { data: storedData };
    }
    const { [STORED_REQUEST_ID_KEY]: requestId, ...data } = storedData;
    return { data, requestId: typeof requestId === 'string' ? requestId : undefined };
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
}
