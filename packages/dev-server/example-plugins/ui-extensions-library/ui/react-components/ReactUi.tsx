import { arrowIcon, layersIcon, starIcon, userIcon } from '@cds/core/icon';
import { NotificationService } from '@vendure/admin-ui/core';
import {
    ActionBar,
    Card,
    CdsIcon,
    FormField,
    Link,
    PageBlock,
    PageDetailLayout,
    useInjector,
    usePageMetadata,
} from '@vendure/admin-ui/react';
import { RichTextEditor } from '@vendure/admin-ui/react';
import React, { PropsWithChildren, useState } from 'react';

export function ReactUi() {
    const notificationService = useInjector(NotificationService);
    const { setTitle } = usePageMetadata();
    const [titleModified, setTitleModified] = useState(false);
    const [titleValue, setTitleValue] = useState('React UI');

    function updateTitle() {
        setTitle(titleValue);
        setTitleModified(false);
        notificationService.success(`Updated title to "${titleValue}"`);
    }

    return (
        <>
            <PageBlock>
                <ActionBar leftContent={<div>Action bar left contents</div>}>
                    <button className="button primary" onClick={updateTitle} disabled={!titleModified}>
                        Update page title
                    </button>
                </ActionBar>
            </PageBlock>

            <PageDetailLayout
                sidebar={
                    <div>
                        <Card>Sidebar content</Card>
                    </div>
                }
            >
                <PageBlock>
                    <Card title="Card">
                        This is a card. On a detail page, content should usually be placed inside a card.
                    </Card>
                    <Card title="Form inputs">
                        <div className="form-grid">
                            <FormField label="Page title">
                                <input
                                    value={titleValue}
                                    onInput={e => {
                                        setTitleValue((e.target as any).value);
                                        setTitleModified(true);
                                    }}
                                />
                            </FormField>
                            <FormField label="Select input">
                                <select>
                                    <option>Option 1</option>
                                    <option>Option 2</option>
                                </select>
                            </FormField>
                            <FormField label="Checkbox input">
                                <input type="checkbox" />
                            </FormField>
                            <FormField label="Textarea input">
                                <textarea></textarea>
                            </FormField>
                            <FormField label="With tooltip" tooltip="This is a tooltip for the form input">
                                <input type="text" />
                            </FormField>
                            <FormField label="Invalid with error" invalid={true}>
                                <input type="text" />
                            </FormField>
                            <RichTextEditor className="form-grid-span" label="Description" readOnly={false} />
                        </div>
                    </Card>

                    <Card title="Icons">
                        <DemoBlock label="Sizes">
                            <CdsIcon icon={starIcon} size={'xs'}></CdsIcon>
                            <CdsIcon icon={starIcon} size={'sm'}></CdsIcon>
                            <CdsIcon icon={starIcon} size={'md'}></CdsIcon>
                            <CdsIcon icon={starIcon} size={'lg'}></CdsIcon>
                            <CdsIcon icon={starIcon} size={'xl'}></CdsIcon>
                            <CdsIcon icon={starIcon} size={'xxl'}></CdsIcon>
                        </DemoBlock>
                        <DemoBlock label="Badges">
                            <CdsIcon icon={userIcon} badge={'success'}></CdsIcon>
                            <CdsIcon icon={userIcon} badge={'info'}></CdsIcon>
                            <CdsIcon icon={userIcon} badge={'warning'}></CdsIcon>
                            <CdsIcon icon={userIcon} badge={'danger'}></CdsIcon>
                        </DemoBlock>
                        <DemoBlock label="Status colors">
                            <CdsIcon icon={userIcon} status={'success'}></CdsIcon>
                            <CdsIcon icon={userIcon} status={'info'}></CdsIcon>
                            <CdsIcon icon={userIcon} status={'warning'}></CdsIcon>
                            <CdsIcon icon={userIcon} status={'danger'}></CdsIcon>
                        </DemoBlock>
                    </Card>

                    <Card title={'Buttons'}>
                        <DemoBlock label="Regular">
                            <button className="button primary">Primary</button>
                            <button className="button secondary">Secondary</button>
                            <button className="button success">Success</button>
                            <button className="button warning">Warning</button>
                            <button className="button danger">Danger</button>
                        </DemoBlock>
                        <DemoBlock label="Ghost">
                            <button className="button-ghost">Ghost</button>
                            <Link className="button-ghost" href="/extensions/ui-library/react-ui">
                                <CdsIcon icon={arrowIcon} direction="right" />
                                John Smith
                            </Link>
                        </DemoBlock>
                        <DemoBlock label="Small">
                            <button className="button-small">Small</button>
                            <button className="button-small">
                                <CdsIcon icon={layersIcon} />
                                Assign to channel
                            </button>
                        </DemoBlock>
                    </Card>
                </PageBlock>
            </PageDetailLayout>
        </>
    );
}

function DemoBlock(props: PropsWithChildren<{ label: string }>) {
    return (
        <div className="mb-4">
            <label>{props.label}</label>
            <div className="mt-1 flex" style={{ gap: '12px' }}>
                {props.children}
            </div>
        </div>
    );
}
