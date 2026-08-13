import { Module } from '@nestjs/common';

import { CONFIGURABLE_OPERATION_TRANSLATOR } from '../common/constants';
import { ConfigModule } from '../config/config.module';

import { I18nService } from './i18n.service';

@Module({
    imports: [ConfigModule],
    providers: [I18nService, { provide: CONFIGURABLE_OPERATION_TRANSLATOR, useExisting: I18nService }],
    exports: [I18nService, CONFIGURABLE_OPERATION_TRANSLATOR],
})
export class I18nModule {}
