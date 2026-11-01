import { OnApplicationBootstrap } from '@nestjs/common';
import { Connection } from 'typeorm';
export declare const p41ReviewGiftChannelColumnsSql = "\nDO $$\nBEGIN\n  IF to_regclass('channel') IS NOT NULL THEN\n    ALTER TABLE channel ADD COLUMN IF NOT EXISTS \"customFieldsReviewgiftqualitycoupontemplateid\" varchar;\n    ALTER TABLE channel ADD COLUMN IF NOT EXISTS \"customFieldsReviewgiftservicecoupontemplateid\" varchar;\n    ALTER TABLE channel ADD COLUMN IF NOT EXISTS \"customFieldsReviewgifttimecoupontemplateid\" varchar;\n  END IF;\nEND $$;\n";
export declare class P41ReviewGiftChannelColumnsMigration implements OnApplicationBootstrap {
    private connection;
    constructor(connection: Connection);
    onApplicationBootstrap(): Promise<void>;
}
