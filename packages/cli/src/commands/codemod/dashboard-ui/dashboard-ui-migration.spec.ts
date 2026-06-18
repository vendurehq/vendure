import { log } from '@clack/prompts';
import { Project, QuoteKind, ScriptKind } from 'ts-morph';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { transformAccordionProps } from './transforms/accordion-props';
import { transformAsChildToRender } from './transforms/as-child-to-render';
import { transformFormComponents } from './transforms/form-components';
import { transformImportConsolidation } from './transforms/import-consolidation';
import { transformSelectItemsProp } from './transforms/select-items-prop';

vi.mock('@clack/prompts', () => ({
    log: {
        warn: vi.fn(),
        info: vi.fn(),
        error: vi.fn(),
        success: vi.fn(),
        step: vi.fn(),
        message: vi.fn(),
    },
    spinner: vi.fn(() => ({ start: vi.fn(), stop: vi.fn() })),
    intro: vi.fn(),
    outro: vi.fn(),
}));

// Share a single Project instance across all tests to avoid repeated TypeScript compiler init
const project = new Project({
    useInMemoryFileSystem: true,
    compilerOptions: { jsx: 2 /* JsxEmit.React */ },
    manipulationSettings: {
        quoteKind: QuoteKind.Single,
        useTrailingCommas: true,
    },
});

let fileCounter = 0;
function createSourceFile(code: string) {
    fileCounter++;
    return project.createSourceFile(`test-${fileCounter}.tsx`, code, { scriptKind: ScriptKind.TSX });
}

// ─── asChild → render ────────────────────────────────────────────────

describe('transformAsChildToRender', () => {
    beforeEach(() => {
        vi.mocked(log.warn).mockClear();
    });

    it('should transform Button with asChild wrapping Link', () => {
        const sf = createSourceFile(`
const el = (
    <Button asChild>
        <Link to="./new">
            <PlusIcon />
            New
        </Link>
    </Button>
);
`);
        const changes = transformAsChildToRender(sf);
        expect(changes).toBe(1);
        const text = sf.getFullText();
        expect(text).toContain('render={<Link to="./new" />}');
        expect(text).not.toContain('asChild');
        expect(text).toContain('<PlusIcon />');
        expect(text).toContain('New');
        // Verify the parent is still a Button
        expect(text).toMatch(/<Button\s/);
    });

    it('should transform asChild with self-closing child', () => {
        const sf = createSourceFile(`
const el = (
    <Button asChild>
        <Link to="/home" />
    </Button>
);
`);
        const changes = transformAsChildToRender(sf);
        expect(changes).toBe(1);
        const text = sf.getFullText();
        expect(text).toContain('render={<Link to="/home" />}');
        expect(text).not.toContain('asChild');
        // Self-closing child with no grandchildren → parent becomes self-closing
        expect(text).toContain('/>');
        expect(text).not.toContain('</Button>');
    });

    it('should preserve other props on the parent element', () => {
        const sf = createSourceFile(`
const el = (
    <Button variant="outline" asChild className="my-btn">
        <Link to="./edit">
            Edit
        </Link>
    </Button>
);
`);
        const changes = transformAsChildToRender(sf);
        expect(changes).toBe(1);
        const text = sf.getFullText();
        expect(text).toContain('variant="outline"');
        expect(text).toContain('className="my-btn"');
        expect(text).toContain('render={<Link to="./edit" />}');
        expect(text).not.toContain('asChild');
    });

    it('should move child props to render and grandchildren to parent', () => {
        const sf = createSourceFile(`
const el = (
    <DialogTrigger asChild>
        <Button variant="destructive" size="sm">
            <TrashIcon />
            Delete
        </Button>
    </DialogTrigger>
);
`);
        const changes = transformAsChildToRender(sf);
        expect(changes).toBe(1);
        const text = sf.getFullText();
        // Child's props (variant, size) should be in the render prop
        expect(text).toContain('render={<Button variant="destructive" size="sm" />}');
        // Grandchildren should be direct children of DialogTrigger now
        expect(text).toContain('<TrashIcon />');
        expect(text).toContain('Delete');
        expect(text).toContain('</DialogTrigger>');
    });

    it('should handle multiple asChild transforms in the same file', () => {
        const sf = createSourceFile(`
function App() {
    return (
        <div>
            <Button asChild>
                <Link to="/a">Go A</Link>
            </Button>
            <Button asChild>
                <Link to="/b">Go B</Link>
            </Button>
        </div>
    );
}
`);
        const changes = transformAsChildToRender(sf);
        expect(changes).toBe(2);
        const text = sf.getFullText();
        expect(text).not.toContain('asChild');
        expect(text).toContain('render={<Link to="/a" />}');
        expect(text).toContain('render={<Link to="/b" />}');
    });

    it('should return 0 when no asChild patterns found', () => {
        const sf = createSourceFile(`
const el = (
    <Button onClick={handleClick}>Click me</Button>
);
`);
        const changes = transformAsChildToRender(sf);
        expect(changes).toBe(0);
    });

    it('should preserve inline whitespace between JSX expression children', () => {
        const sf = createSourceFile(`
const el = (
    <Button asChild variant="ghost">
        <Link to={\`/customers/\${value.id}\`}>
            {value.firstName} {value.lastName}
        </Link>
    </Button>
);
`);
        const changes = transformAsChildToRender(sf);
        expect(changes).toBe(1);
        const text = sf.getFullText();
        expect(text).toContain('render={<Link to={`/customers/${value.id}`} />}');
        // The space between the two expressions must be preserved
        expect(text).toContain('{value.firstName} {value.lastName}');
        expect(text).not.toContain('{value.firstName}{value.lastName}');
    });

    it('should skip asChild with multiple children and warn', () => {
        const sf = createSourceFile(`
const el = (
    <Button asChild>
        <Link to="/a">A</Link>
        <Link to="/b">B</Link>
    </Button>
);
`);
        const changes = transformAsChildToRender(sf);
        // Cannot convert — multiple children
        expect(changes).toBe(0);
        expect(log.warn).toHaveBeenCalledWith(expect.stringContaining('expected exactly 1'));
    });

    it('should skip asChild with JSX expression child and warn', () => {
        const sf = createSourceFile(`
const el = (
    <Button asChild>
        {condition && <Link to="/maybe" />}
    </Button>
);
`);
        const changes = transformAsChildToRender(sf);
        expect(changes).toBe(0);
        expect(log.warn).toHaveBeenCalledWith(expect.stringContaining('non-element child'));
    });

    it('should skip unconvertible asChild and still process valid ones after it', () => {
        const sf = createSourceFile(`
function App() {
    return (
        <div>
            <Button asChild>
                {condition && <Link to="/maybe" />}
            </Button>
            <Button asChild>
                <Link to="/valid">Valid</Link>
            </Button>
        </div>
    );
}
`);
        const changes = transformAsChildToRender(sf);
        // First skipped (JSX expression), second converts
        expect(changes).toBe(1);
        const text = sf.getFullText();
        expect(text).toContain('render={<Link to="/valid" />}');
        // First button still has asChild (unconverted)
        expect(text).toContain('asChild');
    });
});

// ─── FormField → FormFieldWrapper ────────────────────────────────────

describe('transformFormComponents', () => {
    beforeEach(() => {
        vi.mocked(log.warn).mockClear();
    });

    it('should transform a basic FormField with label, description, and control', () => {
        const sf = createSourceFile(`
import { FormField, FormItem, FormLabel, FormControl, FormDescription, FormMessage } from '@vendure/dashboard';

const el = (
    <FormField
        control={form.control}
        name="slug"
        render={({ field }) => (
            <FormItem>
                <FormLabel>Slug</FormLabel>
                <FormControl>
                    <Input {...field} />
                </FormControl>
                <FormDescription>The URL slug.</FormDescription>
                <FormMessage />
            </FormItem>
        )}
    />
);
`);
        const changes = transformFormComponents(sf);
        expect(changes).toBe(1);
        const text = sf.getFullText();
        expect(text).toContain('FormFieldWrapper');
        expect(text).toContain('label="Slug"');
        expect(text).toContain('description="The URL slug."');
        expect(text).toContain('<Input {...field} />');
        // Old wrapper components should be gone from the output
        expect(text).not.toContain('<FormItem>');
        expect(text).not.toContain('<FormControl>');
        expect(text).not.toContain('<FormLabel>');
        expect(text).not.toContain('<FormMessage');
        expect(text).not.toContain('<FormDescription>');
    });

    it('should handle FormField without FormDescription', () => {
        const sf = createSourceFile(`
import { FormField, FormItem, FormLabel, FormControl, FormMessage } from '@vendure/dashboard';

const el = (
    <FormField
        control={form.control}
        name="title"
        render={({ field }) => (
            <FormItem>
                <FormLabel>Title</FormLabel>
                <FormControl>
                    <Input {...field} />
                </FormControl>
                <FormMessage />
            </FormItem>
        )}
    />
);
`);
        const changes = transformFormComponents(sf);
        expect(changes).toBe(1);
        const text = sf.getFullText();
        expect(text).toContain('FormFieldWrapper');
        expect(text).toContain('label="Title"');
        expect(text).not.toContain('description=');
    });

    it('should return 0 when no FormField patterns found', () => {
        const sf = createSourceFile(`
const el = <Input value="hello" onChange={handleChange} />;
`);
        const changes = transformFormComponents(sf);
        expect(changes).toBe(0);
    });

    it('should add TODO when FormControl is missing and warn', () => {
        const sf = createSourceFile(`
import { FormField, FormItem, FormLabel } from '@vendure/dashboard';

const el = (
    <FormField
        control={form.control}
        name="custom"
        render={({ field }) => (
            <FormItem>
                <FormLabel>Custom</FormLabel>
                <div><Input {...field} /></div>
            </FormItem>
        )}
    />
);
`);
        const changes = transformFormComponents(sf);
        expect(changes).toBe(1);
        const text = sf.getFullText();
        expect(text).toContain('TODO');
        expect(text).toContain('migrate manually');
        // Tag should be renamed to FormFieldWrapper to prevent re-matching
        expect(text).toContain('FormFieldWrapper');
        expect(log.warn).toHaveBeenCalledWith(expect.stringContaining('no FormControl found'));
    });

    it('should add TODO when FormLabel contains complex JSX and warn', () => {
        const sf = createSourceFile(`
import { FormField, FormItem, FormLabel, FormControl } from '@vendure/dashboard';

const el = (
    <FormField
        control={form.control}
        name="name"
        render={({ field }) => (
            <FormItem>
                <FormLabel><span>Bold</span> label</FormLabel>
                <FormControl>
                    <Input {...field} />
                </FormControl>
            </FormItem>
        )}
    />
);
`);
        const changes = transformFormComponents(sf);
        expect(changes).toBe(1);
        const text = sf.getFullText();
        expect(text).toContain('TODO');
        expect(log.warn).toHaveBeenCalledWith(expect.stringContaining('complex JSX label'));
    });

    it('should not infinite loop when multiple FormFields cannot be converted', () => {
        const sf = createSourceFile(`
import { FormField, FormItem, FormLabel } from '@vendure/dashboard';

const el = (
    <div>
        <FormField
            control={form.control}
            name="a"
            render={({ field }) => (
                <FormItem>
                    <FormLabel>A</FormLabel>
                    <div><Input {...field} /></div>
                </FormItem>
            )}
        />
        <FormField
            control={form.control}
            name="b"
            render={({ field }) => (
                <FormItem>
                    <FormLabel>B</FormLabel>
                    <div><Input {...field} /></div>
                </FormItem>
            )}
        />
    </div>
);
`);
        // Must complete without hanging
        const changes = transformFormComponents(sf);
        expect(changes).toBe(2);
        const text = sf.getFullText();
        const todoCount = (text.match(/TODO/g) || []).length;
        expect(todoCount).toBe(2);
        // All FormField tags should be renamed — none left as raw <FormField
        expect(text).not.toContain('<FormField ');
    });

    it('should remove unused form imports and add FormFieldWrapper', () => {
        const sf = createSourceFile(`
import { FormField, FormItem, FormLabel, FormControl, FormMessage } from '@vendure/dashboard';
import { Input } from './input';

const el = (
    <FormField
        control={form.control}
        name="name"
        render={({ field }) => (
            <FormItem>
                <FormLabel>Name</FormLabel>
                <FormControl>
                    <Input {...field} />
                </FormControl>
                <FormMessage />
            </FormItem>
        )}
    />
);
`);
        const changes = transformFormComponents(sf);
        expect(changes).toBe(1);
        const text = sf.getFullText();
        // Non-form import should survive
        expect(text).toContain("from './input'");
        // FormFieldWrapper should be added
        expect(text).toContain('FormFieldWrapper');
        // Old form imports should be gone (they're no longer referenced)
        expect(text).not.toMatch(/\bFormItem\b/);
        expect(text).not.toMatch(/\bFormLabel\b/);
        expect(text).not.toMatch(/\bFormControl\b/);
        expect(text).not.toMatch(/\bFormMessage\b/);
    });

    it('should handle multiple FormFields where form sub-components appear multiple times', () => {
        const sf = createSourceFile(`
import { FormField, FormItem, FormLabel, FormControl, FormMessage } from '@vendure/dashboard';

const el = (
    <div>
        <FormField
            control={form.control}
            name="first"
            render={({ field }) => (
                <FormItem>
                    <FormLabel>First</FormLabel>
                    <FormControl>
                        <Input {...field} />
                    </FormControl>
                    <FormMessage />
                </FormItem>
            )}
        />
        <FormField
            control={form.control}
            name="last"
            render={({ field }) => (
                <FormItem>
                    <FormLabel>Last</FormLabel>
                    <FormControl>
                        <Input {...field} />
                    </FormControl>
                    <FormMessage />
                </FormItem>
            )}
        />
    </div>
);
`);
        const changes = transformFormComponents(sf);
        expect(changes).toBe(2);
        const text = sf.getFullText();
        expect(text).toContain('label="First"');
        expect(text).toContain('label="Last"');
        // Both should be converted — no raw <FormField remaining (only FormFieldWrapper)
        expect(text).not.toMatch(/<FormField[\s>]/);
        expect(text).not.toMatch(/<FormField\n/);
        // Old sub-components should be cleaned up
        expect(text).not.toMatch(/\bFormItem\b/);
        expect(text).not.toMatch(/\bFormControl\b/);
    });
});

// ─── Import consolidation ────────────────────────────────────────────

describe('transformImportConsolidation', () => {
    it('should consolidate @radix-ui namespace imports', () => {
        const sf = createSourceFile(`
import * as Dialog from '@radix-ui/react-dialog';
import * as Popover from '@radix-ui/react-popover';

function App() {
    return <Dialog.Root />;
}
`);
        const changes = transformImportConsolidation(sf);
        expect(changes).toBe(2);
        const text = sf.getFullText();
        expect(text).not.toContain('@radix-ui');
        expect(text).toContain("from '@vendure/dashboard'");
    });

    it('should rewrite namespace member access sites to flat names', () => {
        const sf = createSourceFile(`
import * as Dialog from '@radix-ui/react-dialog';

function App() {
    return (
        <Dialog.Root>
            <Dialog.Trigger>Open</Dialog.Trigger>
            <Dialog.Content>
                <Dialog.Title>Title</Dialog.Title>
            </Dialog.Content>
        </Dialog.Root>
    );
}
`);
        const changes = transformImportConsolidation(sf);
        expect(changes).toBe(1);
        const text = sf.getFullText();
        // All dotted namespace access should be gone
        expect(text).not.toContain('Dialog.Root');
        expect(text).not.toContain('Dialog.Trigger');
        expect(text).not.toContain('Dialog.Content');
        expect(text).not.toContain('Dialog.Title');
        // Replaced with flat component names
        expect(text).toContain('<Dialog>');
        expect(text).toContain('</Dialog>');
        expect(text).toContain('<DialogTrigger>');
        expect(text).toContain('<DialogContent>');
        expect(text).toContain('<DialogTitle>');
        // Import should list the flat names
        expect(text).toContain("from '@vendure/dashboard'");
    });

    it('should consolidate @vendure-io/ui named imports', () => {
        const sf = createSourceFile(`
import { Button } from '@vendure-io/ui/components/ui/button';
import { Input } from '@vendure-io/ui/components/ui/input';

function App() {
    return <Button />;
}
`);
        const changes = transformImportConsolidation(sf);
        expect(changes).toBe(2);
        const text = sf.getFullText();
        expect(text).not.toContain('@vendure-io/ui');
        expect(text).toContain("from '@vendure/dashboard'");
        expect(text).toContain('Button');
        expect(text).toContain('Input');
    });

    it('should consolidate @base-ui/react imports', () => {
        const sf = createSourceFile(`
import { Collapsible } from '@base-ui/react/collapsible';

function App() {
    return <Collapsible />;
}
`);
        const changes = transformImportConsolidation(sf);
        expect(changes).toBe(1);
        const text = sf.getFullText();
        expect(text).not.toContain('@base-ui/react');
        expect(text).toContain("from '@vendure/dashboard'");
        expect(text).toContain('Collapsible');
    });

    it('should merge into existing @vendure/dashboard import', () => {
        const sf = createSourceFile(`
import { usePageContext } from '@vendure/dashboard';
import { Button } from '@vendure-io/ui/components/ui/button';

function App() {
    return <Button />;
}
`);
        const changes = transformImportConsolidation(sf);
        expect(changes).toBe(1);
        const text = sf.getFullText();
        expect(text).not.toContain('@vendure-io/ui');
        // Should have exactly one @vendure/dashboard import with both symbols
        const dashboardImportCount = (text.match(/@vendure\/dashboard/g) || []).length;
        expect(dashboardImportCount).toBe(1);
        expect(text).toContain('usePageContext');
        expect(text).toContain('Button');
    });

    it('should preserve aliased imports in the consolidated import', () => {
        const sf = createSourceFile(`
import { Button as RadixButton } from '@radix-ui/react-button';

function App() {
    return <RadixButton />;
}
`);
        const changes = transformImportConsolidation(sf);
        expect(changes).toBe(1);
        const text = sf.getFullText();
        // Old source should be gone
        expect(text).not.toContain('@radix-ui');
        // Alias should be preserved in the new import
        expect(text).toContain('Button as RadixButton');
        expect(text).toContain("from '@vendure/dashboard'");
    });

    it('should handle default imports from Radix packages', () => {
        const sf = createSourceFile(`
import Checkbox from '@radix-ui/react-checkbox';

function App() {
    return <Checkbox />;
}
`);
        const changes = transformImportConsolidation(sf);
        expect(changes).toBe(1);
        const text = sf.getFullText();
        expect(text).not.toContain('@radix-ui');
        expect(text).toContain("from '@vendure/dashboard'");
        expect(text).toContain('Checkbox');
    });

    it('should return 0 when no matching imports found', () => {
        const sf = createSourceFile(`
import { useState } from 'react';

function App() {
    return <div />;
}
`);
        const changes = transformImportConsolidation(sf);
        expect(changes).toBe(0);
    });

    it('should deduplicate when same name appears in multiple sources', () => {
        const sf = createSourceFile(`
import { Button } from '@radix-ui/react-button';
import { Button } from '@vendure-io/ui/components/ui/button';

function App() {
    return <Button />;
}
`);
        const changes = transformImportConsolidation(sf);
        expect(changes).toBe(2);
        const text = sf.getFullText();
        expect(text).not.toContain('@radix-ui');
        expect(text).not.toContain('@vendure-io/ui');
        expect(text).toContain("from '@vendure/dashboard'");
        // Button should appear exactly twice: once in import, once in JSX
        const buttonMatches = text.match(/\bButton\b/g) || [];
        expect(buttonMatches.length).toBe(2);
    });
    it('should rewrite react-hook-form imports to @vendure/dashboard', () => {
        const sf = createSourceFile(`
import { useForm, Controller } from 'react-hook-form';

function App() {
    const form = useForm();
    return <Controller control={form.control} name="x" render={() => <div />} />;
}
`);
        const changes = transformImportConsolidation(sf);
        expect(changes).toBe(1);
        const text = sf.getFullText();
        expect(text).not.toContain("from 'react-hook-form'");
        expect(text).toContain("from '@vendure/dashboard'");
        expect(text).toContain('useForm');
        expect(text).toContain('Controller');
    });

    it('should rewrite @tanstack/react-query imports to @vendure/dashboard', () => {
        const sf = createSourceFile(`
import { useQuery, useMutation } from '@tanstack/react-query';

function App() {
    const { data } = useQuery({ queryKey: ['x'], queryFn: () => null });
    return <div>{data}</div>;
}
`);
        const changes = transformImportConsolidation(sf);
        expect(changes).toBe(1);
        const text = sf.getFullText();
        expect(text).not.toContain("from '@tanstack/react-query'");
        expect(text).toContain("from '@vendure/dashboard'");
        expect(text).toContain('useQuery');
        expect(text).toContain('useMutation');
    });

    it('should rewrite @tanstack/react-router imports to @vendure/dashboard', () => {
        const sf = createSourceFile(`
import { Link, useNavigate } from '@tanstack/react-router';

function App() {
    return <Link to="/home">Home</Link>;
}
`);
        const changes = transformImportConsolidation(sf);
        expect(changes).toBe(1);
        const text = sf.getFullText();
        expect(text).not.toContain("from '@tanstack/react-router'");
        expect(text).toContain("from '@vendure/dashboard'");
        expect(text).toContain('Link');
        expect(text).toContain('useNavigate');
    });

    it('should rewrite sonner toast import to @vendure/dashboard', () => {
        const sf = createSourceFile(`
import { toast } from 'sonner';

function App() {
    return <button onClick={() => toast('done')}>Go</button>;
}
`);
        const changes = transformImportConsolidation(sf);
        expect(changes).toBe(1);
        const text = sf.getFullText();
        expect(text).not.toContain("from 'sonner'");
        expect(text).toContain("from '@vendure/dashboard'");
        expect(text).toContain('toast');
    });

    it('should NOT rewrite @lingui/react/macro imports (Babel macros)', () => {
        const sf = createSourceFile(`
import { Trans, useLingui } from '@lingui/react/macro';

function App() {
    return <Trans>Hello</Trans>;
}
`);
        const changes = transformImportConsolidation(sf);
        expect(changes).toBe(0);
        const text = sf.getFullText();
        expect(text).toContain("from '@lingui/react/macro'");
    });

    it('should rewrite @lingui/react non-macro imports to @vendure/dashboard', () => {
        const sf = createSourceFile(`
import { useLingui } from '@lingui/react';

function App() {
    const { i18n } = useLingui();
    return <div>{i18n.locale}</div>;
}
`);
        const changes = transformImportConsolidation(sf);
        expect(changes).toBe(1);
        const text = sf.getFullText();
        expect(text).not.toContain("from '@lingui/react'");
        expect(text).toContain("from '@vendure/dashboard'");
    });

    it('should keep non-reexported imports from lucide-react (actual icons)', () => {
        const sf = createSourceFile(`
import { PlusIcon, LucideIcon } from 'lucide-react';

function App() {
    return <PlusIcon />;
}
`);
        const changes = transformImportConsolidation(sf);
        expect(changes).toBe(1);
        const text = sf.getFullText();
        // LucideIcon type is re-exported, PlusIcon is not
        expect(text).toContain("from 'lucide-react'");
        expect(text).toContain('PlusIcon');
        expect(text).toContain("from '@vendure/dashboard'");
        expect(text).toContain('LucideIcon');
    });
});

// ─── Accordion props ─────────────────────────────────────────────────

describe('transformAccordionProps', () => {
    it('should remove type="single" from Accordion', () => {
        const sf = createSourceFile(`
const el = (
    <Accordion type="single" className="w-full">
        <AccordionItem value="item-1" />
    </Accordion>
);
`);
        const changes = transformAccordionProps(sf);
        expect(changes).toBe(1);
        const text = sf.getFullText();
        expect(text).not.toContain('type="single"');
        expect(text).toContain('className="w-full"');
    });

    it('should remove type="multiple" from Accordion', () => {
        const sf = createSourceFile(`
const el = (
    <Accordion type="multiple">
        <AccordionItem value="item-1" />
    </Accordion>
);
`);
        const changes = transformAccordionProps(sf);
        expect(changes).toBe(1);
        const text = sf.getFullText();
        expect(text).not.toContain('type="multiple"');
    });

    it('should remove collapsible attribute from Accordion', () => {
        const sf = createSourceFile(`
const el = (
    <Accordion collapsible>
        <AccordionItem value="item-1" />
    </Accordion>
);
`);
        const changes = transformAccordionProps(sf);
        expect(changes).toBe(1);
        const text = sf.getFullText();
        expect(text).not.toContain('collapsible');
    });

    it('should remove both type and collapsible in one pass', () => {
        const sf = createSourceFile(`
const el = (
    <Accordion type="single" collapsible className="w-full">
        <AccordionItem value="item-1" />
    </Accordion>
);
`);
        const changes = transformAccordionProps(sf);
        expect(changes).toBe(2);
        const text = sf.getFullText();
        expect(text).not.toContain('type="single"');
        expect(text).not.toContain('collapsible');
        expect(text).toContain('className="w-full"');
    });

    it('should not touch non-Accordion elements with type prop', () => {
        const sf = createSourceFile(`
const el = (
    <Select type="single">
        <option>One</option>
    </Select>
);
`);
        const changes = transformAccordionProps(sf);
        expect(changes).toBe(0);
        expect(sf.getFullText()).toContain('type="single"');
    });

    it('should return 0 when no Accordion elements found', () => {
        const sf = createSourceFile(`
const el = (
    <div className="container"><p>Hello</p></div>
);
`);
        const changes = transformAccordionProps(sf);
        expect(changes).toBe(0);
    });

    it('should handle self-closing Accordion', () => {
        const sf = createSourceFile(`
const el = <Accordion type="single" collapsible />;
`);
        const changes = transformAccordionProps(sf);
        expect(changes).toBe(2);
        const text = sf.getFullText();
        expect(text).not.toContain('type="single"');
        expect(text).not.toContain('collapsible');
        expect(text).toContain('<Accordion');
    });
});

// ─── Select items prop ───────────────────────────────────────────────

describe('transformSelectItemsProp', () => {
    beforeEach(() => {
        vi.mocked(log.warn).mockClear();
    });

    it('should auto-add items prop from static SelectItem children', () => {
        const sf = createSourceFile(`
const el = (
    <Select value={value} onValueChange={setValue}>
        <SelectTrigger>
            <SelectValue placeholder="Pick" />
        </SelectTrigger>
        <SelectContent>
            <SelectItem value="draft">Draft</SelectItem>
            <SelectItem value="published">Published</SelectItem>
            <SelectItem value="archived">Archived</SelectItem>
        </SelectContent>
    </Select>
);
`);
        const changes = transformSelectItemsProp(sf);
        expect(changes).toBe(1);
        const text = sf.getFullText();
        expect(text).toContain('items={[');
        expect(text).toContain("{ label: 'Draft', value: 'draft' }");
        expect(text).toContain("{ label: 'Published', value: 'published' }");
        expect(text).toContain("{ label: 'Archived', value: 'archived' }");
    });

    it('should not touch Select that already has items prop', () => {
        const sf = createSourceFile(`
const el = (
    <Select items={options} value={value} onValueChange={setValue}>
        <SelectTrigger>
            <SelectValue placeholder="Pick" />
        </SelectTrigger>
        <SelectContent>
            <SelectItem value="a">A</SelectItem>
        </SelectContent>
    </Select>
);
`);
        const changes = transformSelectItemsProp(sf);
        expect(changes).toBe(0);
        expect(log.warn).not.toHaveBeenCalled();
    });

    it('should warn when SelectItem values are dynamic expressions', () => {
        const sf = createSourceFile(`
const el = (
    <Select value={value} onValueChange={setValue}>
        <SelectContent>
            <SelectItem value={item.code}>{item.name}</SelectItem>
        </SelectContent>
    </Select>
);
`);
        const changes = transformSelectItemsProp(sf);
        expect(changes).toBe(0);
        expect(log.warn).toHaveBeenCalledTimes(1);
        expect(log.warn).toHaveBeenCalledWith(expect.stringContaining('dynamic'));
    });

    it('should warn when no SelectItem children are found', () => {
        const sf = createSourceFile(`
const el = (
    <Select value={value} onValueChange={setValue}>
        <SelectTrigger>
            <SelectValue placeholder="Pick" />
        </SelectTrigger>
        <SelectContent>
            {options.map(o => <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>)}
        </SelectContent>
    </Select>
);
`);
        const changes = transformSelectItemsProp(sf);
        expect(changes).toBe(0);
        expect(log.warn).toHaveBeenCalledTimes(1);
    });

    it('should warn for self-closing Select without items', () => {
        const sf = createSourceFile(`
const el = <Select value={value} />;
`);
        const changes = transformSelectItemsProp(sf);
        expect(changes).toBe(0);
        expect(log.warn).toHaveBeenCalledTimes(1);
    });

    it('should return 0 for non-Select elements', () => {
        const sf = createSourceFile(`
const el = <Input value="hello" />;
`);
        const changes = transformSelectItemsProp(sf);
        expect(changes).toBe(0);
        expect(log.warn).not.toHaveBeenCalled();
    });
});
