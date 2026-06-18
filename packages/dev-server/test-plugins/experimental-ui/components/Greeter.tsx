import { userIcon } from '@cds/core/icon';
import { NotificationService } from '@vendure/admin-ui/core';
import { Card, registerCdsIcon, useInjector, usePageMetadata, useRouteParams } from '@vendure/admin-ui/react';
import React, { useEffect, useState } from 'react';

registerCdsIcon(userIcon);

export function Greeter(props: { name: string }) {
    const { params, queryParams } = useRouteParams();
    const notificationService = useInjector(NotificationService);
    const { setTitle, setBreadcrumb } = usePageMetadata();
    const [titleValue, setTitleValue] = useState('');
    const [breadcrumbValue, setBreadcrumbValue] = useState('Greeter');

    useEffect(() => {
        setTitle('My Page');
        setBreadcrumb([
            { link: ['./parent'], label: 'Parent Page' },
            { link: ['./'], label: 'This Page' },
        ]);
    }, []);

    function handleClick() {
        notificationService.success('You clicked me!');
    }

    console.log(
        `Greeter.tsx: params: ${JSON.stringify(params)}, queryParams: ${JSON.stringify(queryParams)}`,
    );

    return (
        <div className="page-block">
            <Card title={`Hello ${props.name}`}>
                <button className="button primary" onClick={handleClick}>
                    Click me
                </button>

                <cds-icon shape="user" flip={'vertical'} badge={'warning'} solid size={'xxl'}></cds-icon>

                <div className="form-grid">
                    <div>
                        <input value={titleValue} onInput={e => setTitleValue((e.target as any).value)} />
                        <button className="button secondary" onClick={() => setTitle(titleValue)}>
                            Set title
                        </button>
                    </div>
                    <div>
                        <input
                            value={breadcrumbValue}
                            onInput={e => setBreadcrumbValue((e.target as any).value)}
                        />
                        <button className="button secondary" onClick={() => setBreadcrumb(breadcrumbValue)}>
                            Set breadcrumb
                        </button>
                    </div>
                </div>
            </Card>

            <Card title={'Buttons'}>
                <div className="flex center" style={{ gap: '12px' }}>
                    <button className="button primary">Primary</button>
                    <button className="button secondary">Secondary</button>
                    <button className="button success">Success</button>
                    <button className="button warning">Warning</button>
                    <button className="button danger">Danger</button>
                    <button className="button-ghost">Ghost</button>
                    <button className="button-small">Small</button>
                </div>
            </Card>

            <Card title={'Testing the card'}>Yolo</Card>
        </div>
    );
}
