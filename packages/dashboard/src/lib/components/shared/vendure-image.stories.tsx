import type { Meta, StoryObj } from '@storybook/react-vite';
import { withDescription } from '../../../../.storybook/with-description.js';
import type { AssetLike } from './vendure-image.js';
import { VendureImage } from './vendure-image.js';

// Mock asset data for demonstrations
const mockAsset: AssetLike = {
    id: '1',
    preview: 'https://demo.vendure.io/assets/preview/ed/chuttersnap-584518-unsplash__preview.jpg',
    name: 'Sample Image',
};

const mockAssetWithFocalPoint: AssetLike = {
    id: '2',
    preview: 'https://demo.vendure.io/assets/preview/ed/chuttersnap-584518-unsplash__preview.jpg',
    name: 'Image with Focal Point',
    focalPoint: { x: 0.75, y: 0.25 },
};

const meta = {
    title: 'Framework/VendureImage',
    component: VendureImage,
    ...withDescription(import.meta.url, './vendure-image.js'),
    parameters: {
        layout: 'centered',
    },
    tags: ['autodocs'],
    argTypes: {
        preset: {
            control: 'select',
            options: ['tiny', 'thumb', 'small', 'medium', 'large', 'full', null],
            description: 'The preset to use for the image',
        },
        mode: {
            control: 'select',
            options: ['crop', 'resize', null],
            description: 'The crop/resize mode to use',
        },
        width: {
            control: 'number',
            description: 'Custom width in pixels',
        },
        height: {
            control: 'number',
            description: 'Custom height in pixels',
        },
        format: {
            control: 'select',
            options: ['jpg', 'jpeg', 'png', 'webp', 'avif', null],
            description: 'The image format',
        },
        quality: {
            control: { type: 'range', min: 1, max: 100, step: 1 },
            description: 'Image quality (1-100)',
        },
        useFocalPoint: {
            control: 'boolean',
            description: 'Whether to use the focal point in crop mode',
        },
    },
} satisfies Meta<typeof VendureImage>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Playground: Story = {
    args: {
        asset: mockAsset,
        preset: 'medium',
        useFocalPoint: true,
    },
    render: args => {
        return <VendureImage {...args} />;
    },
};

export const PresetSizes: Story = {
    render: () => {
        return (
            <div className="space-y-4">
                <div className="space-y-2">
                    <div className="text-sm font-medium">Tiny (50x50)</div>
                    <VendureImage asset={mockAsset} preset="tiny" />
                </div>
                <div className="space-y-2">
                    <div className="text-sm font-medium">Thumb (150x150)</div>
                    <VendureImage asset={mockAsset} preset="thumb" />
                </div>
                <div className="space-y-2">
                    <div className="text-sm font-medium">Small (300x300)</div>
                    <VendureImage asset={mockAsset} preset="small" />
                </div>
                <div className="space-y-2">
                    <div className="text-sm font-medium">Medium (500x500)</div>
                    <VendureImage asset={mockAsset} preset="medium" />
                </div>
            </div>
        );
    },
};

export const CustomDimensions: Story = {
    render: () => {
        return (
            <div className="space-y-4">
                <div className="space-y-2">
                    <div className="text-sm font-medium">200x200 - Crop Mode</div>
                    <VendureImage asset={mockAsset} width={200} height={200} mode="crop" />
                </div>
                <div className="space-y-2">
                    <div className="text-sm font-medium">300x150 - Crop Mode</div>
                    <VendureImage asset={mockAsset} width={300} height={150} mode="crop" />
                </div>
                <div className="space-y-2">
                    <div className="text-sm font-medium">200x200 - Resize Mode</div>
                    <VendureImage asset={mockAsset} width={200} height={200} mode="resize" />
                </div>
            </div>
        );
    },
};

export const Formats: Story = {
    render: () => {
        return (
            <div className="space-y-4">
                <div className="space-y-2">
                    <div className="text-sm font-medium">WebP Format</div>
                    <VendureImage asset={mockAsset} preset="thumb" format="webp" />
                </div>
                <div className="space-y-2">
                    <div className="text-sm font-medium">AVIF Format</div>
                    <VendureImage asset={mockAsset} preset="thumb" format="avif" />
                </div>
                <div className="space-y-2">
                    <div className="text-sm font-medium">JPEG Format with Quality 50</div>
                    <VendureImage asset={mockAsset} preset="thumb" format="jpeg" quality={50} />
                </div>
            </div>
        );
    },
};

export const Fallbacks: Story = {
    render: () => {
        return (
            <div className="space-y-4">
                <div className="space-y-2">
                    <div className="text-sm font-medium">No Asset - Default Placeholder</div>
                    <VendureImage asset={null} preset="thumb" />
                </div>
                <div className="space-y-2">
                    <div className="text-sm font-medium">No Asset - Custom Fallback</div>
                    <VendureImage
                        asset={null}
                        preset="thumb"
                        fallback={
                            <div className="w-[150px] h-[150px] bg-gray-200 flex items-center justify-center rounded-sm">
                                <span className="text-gray-500">Custom Fallback</span>
                            </div>
                        }
                    />
                </div>
            </div>
        );
    },
};
