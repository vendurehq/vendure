import { OnApplicationBootstrap } from '@nestjs/common';
import { Connection } from 'typeorm';
export declare const p46RiderFeishuAppSql = "\nALTER TABLE \"customer\" ADD COLUMN IF NOT EXISTS \"customFieldsRiderfeishuappid\" varchar(255);\n\nDO $$\nBEGIN\n    IF EXISTS (\n        SELECT 1 FROM information_schema.columns\n        WHERE table_schema = 'public'\n          AND table_name = 'customer'\n          AND column_name = 'customFieldsRiderfeishuboundat'\n          -- \u65E0\u65F6\u533A\u7684\u65F6\u95F4\u5217\uFF08\u542B history\uFF09\uFF1A\u6392\u9664 timestamptz\uFF0C\u907F\u514D\u89E6\u78B0\u5DF2\u6B63\u786E\u7684\u5E93\n          AND data_type LIKE 'time%'\n          AND data_type NOT LIKE '%with time zone'\n    ) THEN\n        ALTER TABLE \"customer\"\n            ALTER COLUMN \"customFieldsRiderfeishuboundat\" TYPE timestamptz\n            USING \"customFieldsRiderfeishuboundat\" AT TIME ZONE 'UTC';\n    END IF;\nEND $$;\n";
export declare class P46RiderFeishuAppMigration implements OnApplicationBootstrap {
    private connection;
    constructor(connection: Connection);
    onApplicationBootstrap(): Promise<void>;
}
