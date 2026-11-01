import { OnApplicationBootstrap } from '@nestjs/common';
import { Connection } from 'typeorm';
export declare const p119DailyPushFailSql = "\nALTER TABLE \"channel\" ADD COLUMN IF NOT EXISTS \"customFieldsWaimaidailypushlastfailat\" varchar(16);\nALTER TABLE \"channel\" ADD COLUMN IF NOT EXISTS \"customFieldsWaimaidailypushlastfailreason\" varchar(200);\n";
export declare class P119DailyPushFailMigration implements OnApplicationBootstrap {
    private connection;
    constructor(connection: Connection);
    onApplicationBootstrap(): Promise<void>;
}
