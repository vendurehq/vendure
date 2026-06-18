import { Project, SourceFile } from 'ts-morph';

import { VendurePluginRef } from './vendure-plugin-ref';

export type CommandCategory =
    | `Plugin`
    | `Plugin: UI`
    | `Plugin: Dashboard`
    | `Plugin: Entity`
    | `Plugin: Service`
    | `Plugin: API`
    | `Plugin: Job Queue`
    | `Project: Codegen`
    | `Other`;

export interface BaseCliCommandOptions {
    plugin?: VendurePluginRef;
}

export type CliCommandReturnVal<T extends Record<string, any> = Record<string, any>> = {
    project: Project;
    modifiedSourceFiles: SourceFile[];
} & T;

export interface CliCommandOptions<T extends BaseCliCommandOptions, R extends CliCommandReturnVal> {
    id: string;
    category: CommandCategory;
    description: string;
    run: (options?: Partial<T>) => Promise<R>;
}

export class CliCommand<T extends Record<string, any>, R extends CliCommandReturnVal = CliCommandReturnVal> {
    constructor(private options: CliCommandOptions<T, R>) {}

    get id() {
        return this.options.id;
    }

    get category() {
        return this.options.category;
    }

    get description() {
        return this.options.description;
    }

    run(options?: Partial<T>): Promise<R> {
        return this.options.run(options);
    }
}
