import { Card, useDetailComponentData, useInjector } from '@vendure/admin-ui/react';
import React, { useEffect, useState } from 'react';

import { CmsDataService } from '../providers/cms-data.service';

export function ProductInfo() {
    // The "entity" will vary depending on which detail page this component
    // is embedded in. In this case, it will be a "product" entity.
    const { entity, detailForm } = useDetailComponentData();
    const cmsDataService = useInjector(CmsDataService);
    const [extraInfo, setExtraInfo] = useState<any>();

    useEffect(() => {
        if (!(entity as any)?.id) {
            return;
        }
        const subscription = cmsDataService.getDataFor((entity as any).id).subscribe(data => {
            setExtraInfo(data);
        });
        return () => subscription.unsubscribe();
    }, [(entity as any)?.id]);

    return (
        <div className="mb-4">
            <Card title="CMS Info">
                <pre>{JSON.stringify(extraInfo, null, 2)}</pre>
            </Card>
        </div>
    );
}
