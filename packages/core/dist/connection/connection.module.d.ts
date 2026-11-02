import { DynamicModule } from '@nestjs/common';
import { DataSourceOptions } from 'typeorm';
export declare class ConnectionCoreModule {
}
export declare class ConnectionModule {
    static forRoot(): DynamicModule;
    static forPlugin(): DynamicModule;
    static getTypeOrmLogger(dbConnectionOptions: DataSourceOptions): import("typeorm").Logger | "debug" | "advanced-console" | "simple-console" | "formatted-console" | "file";
}
