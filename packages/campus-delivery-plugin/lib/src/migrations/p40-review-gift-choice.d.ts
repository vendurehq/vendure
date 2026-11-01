import { OnApplicationBootstrap } from '@nestjs/common';
import { Connection } from 'typeorm';
export declare const p40ReviewGiftChoiceSql = "\nDO $$\nBEGIN\n  IF to_regclass('review') IS NOT NULL THEN\n    ALTER TABLE review ADD COLUMN IF NOT EXISTS \"giftChoice\" varchar(16);\n  END IF;\nEND $$;\n";
export declare class P40ReviewGiftChoiceMigration implements OnApplicationBootstrap {
    private connection;
    constructor(connection: Connection);
    onApplicationBootstrap(): Promise<void>;
}
