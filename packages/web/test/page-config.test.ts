import { describe, expect, it } from 'vitest';
import { getPathname, getAppSectionByPath, isAppRoutePath } from '../src/utils/pageConfig';

describe('pageConfig', () => {
  it('normalizes legacy aliases', () => {
    expect(getPathname('/navigation')).toBe('/nav');
    expect(getPathname('/clipboard')).toBe('/snippets');
  });

  it('handles full URLs and strips query/hash', () => {
    expect(getPathname('https://example.com/notes?tab=1#top')).toBe('/notes');
  });

  it('detects app routes via normalized paths', () => {
    expect(isAppRoutePath('/navigation')).toBe(true);
    expect(isAppRoutePath('/unknown')).toBe(false);
  });

  it('resolves section info by path', () => {
    const section = getAppSectionByPath('/clipboard');
    expect(section?.key).toBe('snippets');
    expect(section?.to).toBe('/snippets');
  });
});
