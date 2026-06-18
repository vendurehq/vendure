import { Injectable } from '@nestjs/common';

type ProcessContextType = 'server' | 'worker';
let currentContext: ProcessContextType = 'server';

/**
 * @description
 * The ProcessContext can be injected into your providers & modules in order to know whether it
 * is being executed in the context of the main Vendure server or the worker.
 *
 * @example
 * ```ts
 * import { Injectable, OnApplicationBootstrap } from '\@nestjs/common';
 * import { ProcessContext } from '\@vendure/core';
 *
 * \@Injectable()
 * export class MyService implements OnApplicationBootstrap {
 *   constructor(private processContext: ProcessContext) {}
 *
 *   onApplicationBootstrap() {
 *     if (this.processContext.isServer) {
 *       // code which will only execute when running in
 *       // the server process
 *     }
 *   }
 * }
 * ```
 *
 * @docsCategory common
 */
export class ProcessContext {
    get isServer(): boolean {
        return currentContext === 'server';
    }
    get isWorker(): boolean {
        return currentContext === 'worker';
    }
}

/**
 * @description
 * Should only be called in the core bootstrap functions in order to establish
 * the current process context.
 *
 * @internal
 */
export function setProcessContext(context: ProcessContextType) {
    currentContext = context;
}
