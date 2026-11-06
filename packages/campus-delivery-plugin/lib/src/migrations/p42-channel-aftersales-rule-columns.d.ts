import { OnApplicationBootstrap } from '@nestjs/common';
import { Connection } from 'typeorm';
export declare const p42ChannelAfterSalesRuleColumnsSql = "\nDO $$\nBEGIN\n  IF to_regclass('channel') IS NOT NULL THEN\n    ALTER TABLE channel ADD COLUMN IF NOT EXISTS \"customFieldsAftersalesduesoonhours\" int;\n    ALTER TABLE channel ADD COLUMN IF NOT EXISTS \"customFieldsAftersalesfirstresponsetargethours\" int;\n    ALTER TABLE channel ADD COLUMN IF NOT EXISTS \"customFieldsAftersalesresolvetargethours\" int;\n  END IF;\nEND $$;\n";
export declare class P42ChannelAfterSalesRuleColumnsMigration implements OnApplicationBootstrap {
    private connection;
    constructor(connection: Connection);
    onApplicationBootstrap(): Promise<void>;
}
