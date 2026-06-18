import { ApplicationRef, createComponent, Type, ComponentRef } from '@angular/core';
import { createApplication } from '@angular/platform-browser';
import { HostedComponentContext } from '@vendure/admin-ui/react';
import React, { useContext, useEffect, useRef, useState, PropsWithChildren } from 'react';

type AnyComponentRef = ComponentRef<unknown>;

export function Wrap<T extends Type<any>>(
    props: PropsWithChildren<{ cmp: T; inputs?: { [key: string]: any } }>,
) {
    const context = useContext(HostedComponentContext);
    const hostRef = useRef<HTMLDivElement>(null);
    const [appRef, setAppRef] = useState<ApplicationRef | null>(null);
    const [compRef, setCompRef] = useState<AnyComponentRef | null>(null);

    useEffect(() => {
        void createApplication().then(setAppRef);
        return () => appRef?.destroy();
    }, []);

    useEffect(() => {
        if (appRef && hostRef.current) {
            setCompRef(
                createComponent(props.cmp, {
                    environmentInjector: appRef!.injector as any,
                    hostElement: hostRef!.current!,
                    projectableNodes: [props.children as any],
                }),
            );
        }
        return () => compRef?.destroy();
    }, [appRef, hostRef, props.cmp]);

    useEffect(() => {
        if (compRef) {
            for (const [key, value] of Object.entries(props.inputs || {})) {
                compRef.setInput(key, value);
            }
            compRef.changeDetectorRef.detectChanges();
        }
    }, [compRef, props.inputs]);

    return <div ref={hostRef} />;
}
