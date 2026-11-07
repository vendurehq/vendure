import { OnApplicationBootstrap } from '@nestjs/common';
import { Connection } from 'typeorm';
export declare const addPickedUpAtSql = "\nALTER TABLE \"order\" ADD COLUMN IF NOT EXISTS \"customFieldsPickedupat\" timestamp with time zone;\n";
export declare class AddPickedUpAtMigration implements OnApplicationBootstrap {
    private connection;
    constructor(connection: Connection);
    onApplicationBootstrap(): Promise<void>;
}
