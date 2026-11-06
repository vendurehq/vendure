// Run with `node --require @vendure/cli/register main.ts` from this directory.
// `@lib/*` is mapped in ../tsconfig.base.json, so it must be resolved relative to that file.
import 'reflect-metadata';

import { Dependency } from '@lib/dependency';

function Injectable(): ClassDecorator {
    return () => undefined;
}

function Column(): PropertyDecorator {
    return () => undefined;
}

@Injectable()
class Service {
    @Column()
    label: string;

    constructor(
        readonly dependency: Dependency,
        readonly count: number,
    ) {}
}

const paramTypes: Array<{ name: string }> = Reflect.getMetadata('design:paramtypes', Service) ?? [];
const labelType: { name: string } | undefined = Reflect.getMetadata(
    'design:type',
    Service.prototype,
    'label',
);

process.stdout.write(
    JSON.stringify({
        dependencyName: new Dependency().name,
        paramTypes: paramTypes.map(type => type.name),
        labelType: labelType?.name,
    }),
);
