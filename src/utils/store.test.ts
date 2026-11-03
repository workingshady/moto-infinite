import { describe, expect, it } from 'vitest';
import { mergeSaved, parseJson, sameShape } from './store';

const BASE = { n: 1, s: 'a', b: false, list: ['x'], obj: {} as Record<string, number> };

describe('mergeSaved', () => {
  it('takes saved values of the right shape', () => {
    expect(mergeSaved(BASE, { n: 2, s: 'b', b: true, list: [], obj: { k: 1 } })).toEqual({ n: 2, s: 'b', b: true, list: [], obj: { k: 1 } });
  });
  it('drops wrong types, NaN-like numbers, nulls and unknown keys', () => {
    expect(mergeSaved(BASE, { n: 'big', s: 5, b: null, list: {}, obj: [], extra: 1 })).toEqual(BASE);
    expect(mergeSaved(BASE, { n: null })).toEqual(BASE);
  });
  it.each([null, 42, 'str', [1, 2]])('ignores a non-object save: %s', (raw) => {
    expect(mergeSaved(BASE, raw)).toEqual(BASE);
  });
  it('never returns the defaults object itself', () => {
    expect(mergeSaved(BASE, null)).not.toBe(BASE);
  });
});

describe('parseJson / sameShape', () => {
  it('parses or gives null', () => {
    expect(parseJson('{"a":1}')).toEqual({ a: 1 });
    expect(parseJson('{"a":')).toBeNull();
    expect(parseJson(null)).toBeNull();
    expect(parseJson('')).toBeNull();
  });
  it('compares JSON shapes', () => {
    expect(sameShape([], ['a'])).toBe(true);
    expect(sameShape({}, [])).toBe(false);
    expect(sameShape(Infinity, 1)).toBe(false);
    expect(sameShape('x', '')).toBe(true);
  });
});
