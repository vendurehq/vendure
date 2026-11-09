import { OnApplicationBootstrap } from '@nestjs/common';
import { Connection } from 'typeorm';
export declare const p46RiderFeishuAppSql = "\nALTER TABLE \"customer\" ADD COLUMN IF NOT EXISTS \"customFieldsRiderfeishuappid\" varchar(255)\n";
export declare class P46RiderFeishuAppMigration implements OnApplicationBootstrap {
    private connection;
    constructor(connection: Connection);
    onApplicationBootstrap(): Promise<void>;
}
