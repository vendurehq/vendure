import { Node, Scope } from 'ts-morph';

import { ServiceRef } from '../../../shared/service-ref.js';
import { addImportsToFile } from '../../../utilities/ast-utils.js';
import { camelCase, pascalCase } from '../../../utilities/case-utils.js';

/**
 * Adds a job queue to a service: the queue property, its creation in `onModuleInit`, and a
 * `trigger<Name>` method. It prints nothing and does not save.
 */
export function scaffoldJobQueue(serviceRef: ServiceRef, jobQueueName: string): { triggerMethod: string } {
    addImportsToFile(serviceRef.classDeclaration.getSourceFile(), {
        moduleSpecifier: '@vendure/core',
        namedImports: ['JobQueue', 'JobQueueService', 'SerializedRequestContext'],
    });

    addImportsToFile(serviceRef.classDeclaration.getSourceFile(), {
        moduleSpecifier: '@vendure/common/lib/generated-types',
        namedImports: ['JobState'],
    });

    addImportsToFile(serviceRef.classDeclaration.getSourceFile(), {
        moduleSpecifier: '@nestjs/common',
        namedImports: ['OnModuleInit'],
    });

    serviceRef.injectDependency({
        name: 'jobQueueService',
        type: 'JobQueueService',
    });

    const jobQueuePropertyName = camelCase(jobQueueName) + 'Queue';

    serviceRef.classDeclaration.insertProperty(0, {
        name: jobQueuePropertyName,
        scope: Scope.Private,
        type: writer => writer.write('JobQueue<{ ctx: SerializedRequestContext, someArg: string; }>'),
    });

    serviceRef.classDeclaration.addImplements('OnModuleInit');
    let onModuleInitMethod = serviceRef.classDeclaration.getMethod('onModuleInit');
    if (!onModuleInitMethod) {
        const constructor = serviceRef.classDeclaration.getConstructors()[0];
        const constructorChildIndex = constructor?.getChildIndex() ?? 0;

        onModuleInitMethod = serviceRef.classDeclaration.insertMethod(constructorChildIndex + 1, {
            name: 'onModuleInit',
            isAsync: false,
            returnType: 'void',
            scope: Scope.Public,
        });
    }
    onModuleInitMethod.setIsAsync(true);
    onModuleInitMethod.setReturnType('Promise<void>');
    const body = onModuleInitMethod.getBody();
    if (Node.isBlock(body)) {
        body.addStatements(writer => {
            writer
                .write(
                    `this.${jobQueuePropertyName} = await this.jobQueueService.createQueue({
                name: '${jobQueueName}',
                process: async job => {
                    // Deserialize the RequestContext from the job data
                    const ctx = RequestContext.deserialize(job.data.ctx);
                    // The "someArg" property is passed in when the job is triggered
                    const someArg = job.data.someArg;

                    // Inside the \`process\` function we define how each job
                    // in the queue will be processed.
                    // Let's simulate some long-running task
                    const totalItems = 10;
                    for (let i = 0; i < totalItems; i++) {
                        await new Promise(resolve => setTimeout(resolve, 500));

                        // You can optionally respond to the job being cancelled
                        // during processing. This can be useful for very long-running
                        // tasks which can be cancelled by the user.
                        if (job.state === JobState.CANCELLED) {
                            throw new Error('Job was cancelled');
                        }

                        // Progress can be reported as a percentage like this
                        job.setProgress(Math.floor(i / totalItems * 100));
                    }

                    // The value returned from the \`process\` function is stored
                    // as the "result" field of the job
                    return {
                        processedCount: totalItems,
                        message: \`Successfully processed \${totalItems} items\`,
                    };
                },
            })`,
                )
                .newLine();
        }).forEach(s => s.formatText());
    }

    serviceRef.classDeclaration
        .addMethod({
            name: `trigger${pascalCase(jobQueueName)}`,
            scope: Scope.Public,
            parameters: [{ name: 'ctx', type: 'RequestContext' }],
            statements: writer => {
                writer.write(`return this.${jobQueuePropertyName}.add({
                ctx: ctx.serialize(),
                someArg: 'foo',
            })`);
            },
        })
        .formatText();

    return { triggerMethod: `trigger${pascalCase(jobQueueName)}` };
}
