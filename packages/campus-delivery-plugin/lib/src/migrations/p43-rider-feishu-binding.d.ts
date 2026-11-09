import { OnApplicationBootstrap } from '@nestjs/common';
import { Connection } from 'typeorm';
export declare const p43RiderFeishuBindingSql = "\nALTER TABLE \"customer\" ADD COLUMN IF NOT EXISTS \"customFieldsRiderfeishuopenid\" varchar(255);\nALTER TABLE \"customer\" ADD COLUMN IF NOT EXISTS \"customFieldsRiderfeishuboundat\" timestamp\n";
export declare class P43RiderFeishuBindingMigration implements OnApplicationBootstrap {
    private connection;
    constructor(connection: Connection);
    onApplicationBootstrap(): Promise<void>;
}
