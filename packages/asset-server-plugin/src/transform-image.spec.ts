import { describe, expect, it } from 'vitest';

import { Dimensions, Point, resizeToFocalPoint } from './transform-image';

describe('resizeToFocalPoint', () => {
    it('no resize, crop left', () => {
        const original: Dimensions = { w: 200, h: 100 };
        const target: Dimensions = { w: 100, h: 100 };
        const focalPoint: Point = { x: 50, y: 50 };
        const result = resizeToFocalPoint(original, target, focalPoint);

        expect(result.width).toBe(200);
        expect(result.height).toBe(100);
        expect(result.region).toEqual({
            left: 0,
            top: 0,
            width: 100,
            height: 100,
        });
    });

    it('no resize, crop top left', () => {
        const original: Dimensions = { w: 200, h: 100 };
        const target: Dimensions = { w: 100, h: 100 };
        const focalPoint: Point = { x: 0, y: 0 };
        const result = resizeToFocalPoint(original, target, focalPoint);

        expect(result.width).toBe(200);
        expect(result.height).toBe(100);
        expect(result.region).toEqual({
            left: 0,
            top: 0,
            width: 100,
            height: 100,
        });
    });

    it('no resize, crop center', () => {
        const original: Dimensions = { w: 200, h: 100 };
        const target: Dimensions = { w: 100, h: 100 };
        const focalPoint: Point = { x: 100, y: 50 };
        const result = resizeToFocalPoint(original, target, focalPoint);

        expect(result.width).toBe(200);
        expect(result.height).toBe(100);
        expect(result.region).toEqual({
            left: 50,
            top: 0,
            width: 100,
            height: 100,
        });
    });

    it('crop with resize', () => {
        const original: Dimensions = { w: 200, h: 100 };
        const target: Dimensions = { w: 25, h: 50 };
        const focalPoint: Point = { x: 50, y: 50 };
        const result = resizeToFocalPoint(original, target, focalPoint);

        expect(result.width).toBe(100);
        expect(result.height).toBe(50);
        expect(result.region).toEqual({
            left: 13,
            top: 0,
            width: 25,
            height: 50,
        });
    });
});
