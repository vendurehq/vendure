import { Module } from '@nestjs/common';

import { ConfigModule } from '../config/config.module';

import { I18nService } from './i18n.service';

@Module({
    imports: [ConfigModule],
    providers: [I18nService],
    exports: [I18nService],
})
export class I18nModule {}
