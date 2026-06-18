import { cancel, isCancel, log, text } from '@clack/prompts';
import { camelCase, pascalCase } from 'change-case';
import { Node, Scope } from 'ts-morph';

import { CliCommand, CliCommandReturnVal } from '../../../shared/cli-command';
import { resolvePluginFromOptions } from '../../../shared/plugin-resolution';
import { ServiceRef } from '../../../shared/service-ref';
import { analyzeProject, getServices, selectPlugin, selectServiceRef } from '../../../shared/shared-prompts';
import { VendurePluginRef } from '../../../shared/vendure-plugin-ref';
import { addImportsToFile } from '../../../utilities/ast-utils';
import { withInteractiveTimeout } from '../../../utilities/utils';

const cancelledMessage = 'Add API extension cancelled';

export interface AddJobQueueOptions {
    plugin?: VendurePluginRef;
    pluginName?: string;
    name?: string;
    selectedService?: string;
    config?: string;
    isNonInteractive?: boolean;
}

export const addJobQueueCommand = new CliCommand({
    id: 'add-job-queue',
    category: 'Plugin: Job Queue',
    description: 'Defines an new job queue on a service',
    run: options => addJobQueue(options),
});

export async function addJobQueue(
    options?: AddJobQueueOptions,
): Promise<CliCommandReturnVal<{ serviceRef: ServiceRef }>> {
    const providedVendurePlugin = options?.plugin;
    const { project } = await analyzeProject({
        providedVendurePlugin,
        cancelledMessage,
        config: options?.config,
    });

    const { plugin: resolvedPlugin, shouldPromptForSelection } = resolvePluginFromOptions(project, {
        providedPlugin: providedVendurePlugin,
        pluginName: options?.pluginName,
        isNonInteractive: options?.isNonInteractive === true,
    });

    // In non-interactive mode, we need all required values upfront
    if (options?.isNonInteractive) {
        if (!options?.name) {
            throw new Error(
                'Job queue name must be specified in non-interactive mode.\n' +
                    'Usage: npx vendure add -j <PluginName> --name <job-queue-name> --selected-service <service-name>',
            );
        }
        if (!options?.selectedService) {
            throw new Error(
                'Service must be specified in non-interactive mode.\n' +
                    'Usage: npx vendure add -j <PluginName> --name <job-queue-name> --selected-service <service-name>',
            );
        }
    }

    const plugin = resolvedPlugin ?? (await selectPlugin(project, cancelledMessage));

    let serviceRef: ServiceRef | undefined;

    if (options?.isNonInteractive) {
        const existingServices = getServices(project).filter(sr => {
            return sr.classDeclaration
                .getSourceFile()
                .getDirectoryPath()
                .includes(plugin.getSourceFile().getDirectoryPath());
        });

        const selectedService = existingServices.find(sr => sr.name === options.selectedService);

        if (!selectedService) {
            const availableServices = existingServices.map(sr => sr.name);
            if (availableServices.length === 0) {
                throw new Error(
                    `No services found in plugin "${plugin.name}".\n` +
                        'Please first create a service using: npx vendure add -s <ServiceName>',
                );
            } else {
                throw new Error(
                    `Service "${options.selectedService as string}" not found in plugin "${plugin.name}". Available services:\n` +
                        availableServices.map(name => `  - ${name}`).join('\n'),
                );
            }
        }

        serviceRef = selectedService;
        log.info(`Using service: ${serviceRef.name}`);
    } else {
        serviceRef = await selectServiceRef(project, plugin);
    }

    if (!serviceRef) {
        throw new Error('Service is required for job queue');
    }

    const jobQueueName =
        options?.name ??
        (await withInteractiveTimeout(async () => {
            return await text({
                message: 'What is the name of the job queue?',
                initialValue: 'my-background-task',
                validate: input => {
                    if (!/^[a-z][a-z-0-9]+$/.test(input)) {
                        return 'The job queue name must be lowercase and contain only letters, numbers and dashes';
                    }
                },
            });
        }));

    if (!options?.isNonInteractive && isCancel(jobQueueName)) {
        cancel(cancelledMessage);
        process.exit(0);
    }

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

    const jobQueuePropertyName = camelCase(jobQueueName as string) + 'Queue';

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
                name: '${jobQueueName as string}',
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
            name: `trigger${pascalCase(jobQueueName as string)}`,
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

    log.success(`New job queue created in ${serviceRef.name}`);

    await project.save();

    return { project, modifiedSourceFiles: [serviceRef.classDeclaration.getSourceFile()], serviceRef };
}
