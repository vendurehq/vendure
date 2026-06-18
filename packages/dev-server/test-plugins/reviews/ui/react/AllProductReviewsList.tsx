import { CardComponent, DatetimePickerComponent, NotificationService } from '@vendure/admin-ui/core';
import { useInjector, usePageMetadata } from '@vendure/admin-ui/react';
import React, { useState, useEffect } from 'react';

import { Wrap } from './Wrap';

export function AllProductReviewsList(props: { name: string }) {
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

    return (
        <div className="page-block">
            <h2>Hello {props.name}</h2>
            <button className="button primary" onClick={handleClick}>
                Click me
            </button>
            <div className="card">
                <input value={titleValue} onInput={e => setTitleValue((e.target as any).value)} />
                <button className="button secondary" onClick={() => setTitle(titleValue)}>
                    Set title
                </button>
            </div>
            <div className="card">
                <input value={breadcrumbValue} onInput={e => setBreadcrumbValue((e.target as any).value)} />
                <button className="button secondary" onClick={() => setBreadcrumb(breadcrumbValue)}>
                    Set breadcrumb
                </button>
            </div>
            hello
        </div>
    );
}
