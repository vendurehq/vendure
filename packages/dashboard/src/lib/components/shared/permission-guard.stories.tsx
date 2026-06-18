import { Button } from '@/vdb/components/ui/button.js';
import type { Meta, StoryObj } from '@storybook/react-vite';
import { withDescription } from '../../../../.storybook/with-description.js';
import { PermissionGuard } from './permission-guard.js';

const meta = {
    title: 'Framework/PermissionGuard',
    component: PermissionGuard,
    ...withDescription(import.meta.url, './permission-guard.js'),
    parameters: {
        layout: 'centered',
    },
    tags: ['autodocs'],
} satisfies Meta<typeof PermissionGuard>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Playground: Story = {
    render: () => {
        return (
            <div className="space-y-6">
                <div className="space-y-2">
                    <div className="text-sm font-medium">
                        Has Permission (ReadCatalog) - Button should be visible
                    </div>
                    <PermissionGuard requires={['ReadCatalog']}>
                        <Button>View Catalog</Button>
                    </PermissionGuard>
                </div>

                <div className="space-y-2">
                    <div className="text-sm font-medium">
                        No Permission (NonExistentPermission) - Button should be hidden
                    </div>
                    <PermissionGuard requires={['NonExistentPermission']}>
                        <Button variant="destructive">Delete Catalog</Button>
                    </PermissionGuard>
                    <div className="text-xs text-muted-foreground">
                        (The delete button is hidden because user lacks NonExistentPermission permission)
                    </div>
                </div>
            </div>
        );
    },
};
