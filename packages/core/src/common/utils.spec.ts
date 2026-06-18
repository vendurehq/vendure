import { describe, expect, it } from 'vitest';

import { convertRelationPaths, isEmailAddressLike, normalizeEmailAddress } from './utils';

describe('convertRelationPaths()', () => {
    it('undefined', () => {
        const result = convertRelationPaths<any>(undefined);
        expect(result).toEqual(undefined);
    });

    it('null', () => {
        const result = convertRelationPaths<any>(null);
        expect(result).toEqual(undefined);
    });

    it('single relation', () => {
        const result = convertRelationPaths<any>(['a']);
        expect(result).toEqual({
            a: true,
        });
    });

    it('flat list', () => {
        const result = convertRelationPaths<any>(['a', 'b', 'c']);
        expect(result).toEqual({
            a: true,
            b: true,
            c: true,
        });
    });

    it('three-level nested', () => {
        const result = convertRelationPaths<any>(['a', 'b.c', 'd.e.f']);
        expect(result).toEqual({
            a: true,
            b: {
                c: true,
            },
            d: {
                e: {
                    f: true,
                },
            },
        });
    });
});

describe('normalizeEmailAddress()', () => {
    it('should trim whitespace', () => {
        expect(normalizeEmailAddress('  test@test.com  ')).toBe('test@test.com');
    });

    it('should lowercase email addresses', async () => {
        expect(normalizeEmailAddress('JoeSmith@test.com')).toBe('joesmith@test.com');
        expect(normalizeEmailAddress('TEST@TEST.COM')).toBe('test@test.com');
        expect(normalizeEmailAddress('test.person@TEST.COM')).toBe('test.person@test.com');
        expect(normalizeEmailAddress('test.person+Extra@TEST.COM')).toBe('test.person+extra@test.com');
        expect(normalizeEmailAddress('TEST-person+Extra@TEST.COM')).toBe('test-person+extra@test.com');
        expect(normalizeEmailAddress('我買@屋企.香港')).toBe('我買@屋企.香港');
    });

    it('ignores surrounding whitespace', async () => {
        expect(normalizeEmailAddress(' JoeSmith@test.com')).toBe('joesmith@test.com');
        expect(normalizeEmailAddress('TEST@TEST.COM ')).toBe('test@test.com');
        expect(normalizeEmailAddress('  test.person@TEST.COM ')).toBe('test.person@test.com');
    });

    it('should not lowercase non-email address identifiers', async () => {
        expect(normalizeEmailAddress('Test')).toBe('Test');
        expect(normalizeEmailAddress('Ucj30Da2.!3rAA')).toBe('Ucj30Da2.!3rAA');
    });
});

describe('isEmailAddressLike()', () => {
    it('returns true for valid email addresses', () => {
        expect(isEmailAddressLike('simple@example.com')).toBe(true);
        expect(isEmailAddressLike('very.common@example.com')).toBe(true);
        expect(isEmailAddressLike('abc@example.co.uk')).toBe(true);
        expect(isEmailAddressLike('disposable.style.email.with+symbol@example.com')).toBe(true);
        expect(isEmailAddressLike('other.email-with-hyphen@example.com')).toBe(true);
        expect(isEmailAddressLike('fully-qualified-domain@example.com')).toBe(true);
        expect(isEmailAddressLike('user.name+tag+sorting@example.com')).toBe(true);
        expect(isEmailAddressLike('example-indeed@strange-example.com')).toBe(true);
        expect(isEmailAddressLike('example-indeed@strange-example.inininini')).toBe(true);
    });

    it('ignores surrounding whitespace', () => {
        expect(isEmailAddressLike(' simple@example.com')).toBe(true);
        expect(isEmailAddressLike('very.common@example.com ')).toBe(true);
        expect(isEmailAddressLike('  abc@example.co.uk  ')).toBe(true);
    });

    it('returns false for invalid email addresses', () => {
        expect(isEmailAddressLike('username')).toBe(false);
        expect(isEmailAddressLike('823@ee28qje')).toBe(false);
        expect(isEmailAddressLike('Abc.example.com')).toBe(false);
        expect(isEmailAddressLike('A@b@')).toBe(false);
    });
});
