import { Module } from '@nestjs/common';

import { ConfigModule } from '../config/config.module';
import { ConnectionModule } from '../connection/connection.module';
import { PluginModule } from '../plugin/plugin.module';
import { ServiceModule } from '../service/service.module';

import { AssetImporter } from './providers/asset-importer/asset-importer';
import { ImportParser } from './providers/import-parser/import-parser';
import { FastImporterService } from './providers/importer/fast-importer.service';
import { Importer } from './providers/importer/importer';
import { Populator } from './providers/populator/populator';

@Module({
    // Important! PluginModule must be defined before ServiceModule
    // in order that overrides of Services (e.g. SearchService) are correctly
    // registered with the injector.
    imports: [PluginModule.forRoot(), ServiceModule, ConnectionModule.forPlugin(), ConfigModule],
    exports: [ImportParser, Importer, Populator, FastImporterService, AssetImporter],
    providers: [ImportParser, Importer, Populator, FastImporterService, AssetImporter],
})
export class DataImportModule {}
