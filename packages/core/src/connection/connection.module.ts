import { DynamicModule, Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { DataSourceOptions } from 'typeorm';

import { ConfigModule } from '../config/config.module';
import { ConfigService } from '../config/config.service';
import { TypeOrmLogger } from '../config/logger/typeorm-logger';

import { CustomFieldsValidationSubscriber } from './custom-fields-validation-subscriber';
import { TransactionSubscriber } from './transaction-subscriber';
import { TransactionWrapper } from './transaction-wrapper';
import { TransactionalConnection } from './transactional-connection';

let defaultTypeOrmModule: DynamicModule;
@Module({
    imports: [ConfigModule],
    providers: [
        TransactionalConnection,
        TransactionSubscriber,
        TransactionWrapper,
        CustomFieldsValidationSubscriber,
    ],
    exports: [
        TransactionalConnection,
        TransactionSubscriber,
        TransactionWrapper,
        CustomFieldsValidationSubscriber,
    ],
})
export class ConnectionCoreModule {}

@Module({
    imports: [ConnectionCoreModule],
    exports: [ConnectionCoreModule],
})
export class ConnectionModule {
    static forRoot(): DynamicModule {
        if (!defaultTypeOrmModule) {
            defaultTypeOrmModule = TypeOrmModule.forRootAsync({
                imports: [ConfigModule],
                useFactory: (configService: ConfigService) => {
                    const { dbConnectionOptions } = configService;
                    const logger = ConnectionModule.getTypeOrmLogger(dbConnectionOptions);
                    return {
                        ...dbConnectionOptions,
                        logger,
                    };
                },
                inject: [ConfigService],
            });
        }
        return {
            module: ConnectionModule,
            imports: [defaultTypeOrmModule],
        };
    }

    static forPlugin(): DynamicModule {
        return {
            module: ConnectionModule,
            imports: [TypeOrmModule.forFeature()],
        };
    }

    static getTypeOrmLogger(dbConnectionOptions: DataSourceOptions) {
        if (!dbConnectionOptions.logger) {
            return new TypeOrmLogger(dbConnectionOptions.logging);
        } else {
            return dbConnectionOptions.logger;
        }
    }
}
