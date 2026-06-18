import { DynamicModule, Global, Module } from '@nestjs/common';

import { ProcessContext } from './process-context';

@Global()
@Module({
    providers: [ProcessContext],
    exports: [ProcessContext],
})
export class ProcessContextModule {}
