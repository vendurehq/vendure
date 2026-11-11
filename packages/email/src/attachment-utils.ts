import { Logger } from '@vendure/core';
import { Readable, Stream } from 'stream';
import { format, Url } from 'url';

import { loggerCtx } from './constants';
import { EmailAttachment, SerializedAttachment } from './types';

export async function serializeAttachments(attachments: EmailAttachment[]): Promise<SerializedAttachment[]> {
    const promises = attachments.map(async a => {
        const stringPath = (path: string | Url) => (typeof path === 'string' ? path : format(path));
        const content = a.content instanceof Stream ? await streamToBuffer(a.content) : a.content;
        return {
            filename: null,
            cid: null,
            encoding: null,
            contentType: null,
            contentTransferEncoding: null,
            contentDisposition: null,
            headers: null,
            ...a,
            path: a.path ? stringPath(a.path) : null,
            content: JSON.stringify(content),
        };
    });
    return Promise.all(promises);
}

export function deserializeAttachments(serializedAttachments: SerializedAttachment[]): EmailAttachment[] {
    return serializedAttachments.map(a => {
        const content = parseContent(a.content);
        if (content instanceof Buffer && 50 * 1024 <= content.length) {
            Logger.warn(
                `Email has a large 'content' attachment (${Math.round(
                    content.length / 1024,
                )}k). Consider using the 'path' instead for improved performance.`,
                loggerCtx,
            );
        }
        return {
            filename: nullToUndefined(a.filename),
            cid: nullToUndefined(a.cid),
            encoding: nullToUndefined(a.encoding),
            contentType: nullToUndefined(a.contentType),
            contentTransferEncoding: nullToUndefined(a.contentTransferEncoding),
            contentDisposition: nullToUndefined(a.contentDisposition),
            headers: nullToUndefined(a.headers),
            path: nullToUndefined(a.path),
            content,
        };
    });
}

function parseContent(content: string | null): string | Buffer | undefined {
    try {
        const parsedContent = content && JSON.parse(content);
        if (typeof parsedContent === 'string') {
            return parsedContent;
        } else if (parsedContent.hasOwnProperty('data')) {
            return Buffer.from(parsedContent.data);
        }
    } catch (e: any) {
        // empty
    }
}

function streamToBuffer(stream: Readable): Promise<Buffer> {
    const chunks: Buffer[] = [];
    return new Promise((resolve, reject) => {
        stream.on('data', chunk => {
            chunks.push(Buffer.from(chunk));
        });
        stream.on('error', err => reject(err));
        stream.on('end', () => {
            resolve(Buffer.concat(chunks));
        });
    });
}

function nullToUndefined<T>(input: T | null): T | undefined {
    return input == null ? undefined : input;
}
