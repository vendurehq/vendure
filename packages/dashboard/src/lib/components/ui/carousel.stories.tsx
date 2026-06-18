import type { Meta, StoryObj } from '@storybook/react-vite';
import { Carousel, CarouselContent, CarouselItem, CarouselNext, CarouselPrevious } from './carousel.js';

const meta = {
    title: 'UI/Carousel',
    component: Carousel,
    parameters: {
        layout: 'centered',
    },
    tags: ['autodocs'],
} satisfies Meta<typeof Carousel>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Playground: Story = {
    render: () => (
        <Carousel className="w-full max-w-xs">
            <CarouselContent>
                {Array.from({ length: 5 }).map((_, index) => (
                    <CarouselItem key={index}>
                        <div className="p-1">
                            <div className="flex aspect-square items-center justify-center p-6 border rounded-lg">
                                <span className="text-4xl font-semibold">{index + 1}</span>
                            </div>
                        </div>
                    </CarouselItem>
                ))}
            </CarouselContent>
            <CarouselPrevious />
            <CarouselNext />
        </Carousel>
    ),
};
