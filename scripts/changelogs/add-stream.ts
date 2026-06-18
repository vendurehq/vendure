import * as Stream from 'stream';
import { PassThrough, Writable } from 'stream';

class Appendee extends PassThrough {
    constructor(private factory: any, private opts: any) {
        super(opts);
    }

    _flush(end: any) {
        const stream = this.factory();
        stream.pipe(new Appender(this, this.opts))
            .on('finish', end);
        stream.resume();
    }
}

class Appender extends Writable {
    constructor(private target: any, opts: any) {
        super(opts);
    }

    _write(chunk: any, enc: any, cb: any) {
        this.target.push(chunk);
        cb();
    }
}

/**
 * Append the contents of one stream onto another.
 * Based on https://github.com/wilsonjackson/add-stream
 */
export function addStream(stream: any, opts?: any) {
    opts = opts || {};
    let factory;
    if (typeof stream === 'function') {
        factory = stream;
    } else {
        stream.pause();
        factory = () => stream;
    }
    return new Appendee(factory, opts);
}
