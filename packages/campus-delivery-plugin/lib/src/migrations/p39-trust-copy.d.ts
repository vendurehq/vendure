import { OnApplicationBootstrap } from '@nestjs/common';
import { Connection } from 'typeorm';
export declare const p39TrustCopySql = "\nALTER TABLE campus_fulfillment_config ADD COLUMN IF NOT EXISTS \"trustQualityEnabled\" boolean DEFAULT true;\nALTER TABLE campus_fulfillment_config ADD COLUMN IF NOT EXISTS \"trustQualityText\" varchar(80);\nALTER TABLE campus_fulfillment_config ADD COLUMN IF NOT EXISTS \"trustServiceEnabled\" boolean DEFAULT true;\nALTER TABLE campus_fulfillment_config ADD COLUMN IF NOT EXISTS \"trustServiceText\" varchar(80);\nALTER TABLE campus_fulfillment_config ADD COLUMN IF NOT EXISTS \"trustTimeEnabled\" boolean DEFAULT true;\nALTER TABLE campus_fulfillment_config ADD COLUMN IF NOT EXISTS \"trustTimeText\" varchar(80);\n";
export declare class P39TrustCopyMigration implements OnApplicationBootstrap {
    private connection;
    constructor(connection: Connection);
    onApplicationBootstrap(): Promise<void>;
}
