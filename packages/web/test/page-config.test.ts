import { describe, expect, it } from 'vitest';
import { getPathname, getAppSectionByPath, isAppRoutePath } from '../src/utils/pageConfig';

describe('pageConfig', () => {
  describe('path normalization', () => {
    it('normalizes legacy aliases to /riku/* paths', () => {
      expect(getPathname('/navigation')).toBe('/riku/nav');
      expect(getPathname('/nav')).toBe('/riku/nav');
      expect(getPathname('/clipboard')).toBe('/riku/snippets');
      expect(getPathname('/snippets')).toBe('/riku/snippets');
      expect(getPathname('/notes')).toBe('/riku/notes');
    });

    it('keeps /riku/* paths unchanged', () => {
      expect(getPathname('/riku/nav')).toBe('/riku/nav');
      expect(getPathname('/riku/snippets')).toBe('/riku/snippets');
      expect(getPathname('/riku/notes')).toBe('/riku/notes');
    });

    it('handles full URLs and strips query/hash', () => {
      expect(getPathname('https://example.com/riku/notes?tab=1#top')).toBe('/riku/notes');
      expect(getPathname('https://example.com/notes?tab=1#top')).toBe('/riku/notes');
    });
  });

  describe('route detection', () => {
    it('detects app routes via normalized paths', () => {
      expect(isAppRoutePath('/riku/nav')).toBe(true);
      expect(isAppRoutePath('/navigation')).toBe(true);
      expect(isAppRoutePath('/nav')).toBe(true);
      expect(isAppRoutePath('/unknown')).toBe(false);
    });
  });

  describe('section resolution', () => {
    it('resolves section info by /riku/* path', () => {
      const section = getAppSectionByPath('/riku/snippets');
      expect(section?.key).toBe('snippets');
      expect(section?.to).toBe('/riku/snippets');
    });

    it('resolves section info by legacy alias', () => {
      const section = getAppSectionByPath('/clipboard');
      expect(section?.key).toBe('snippets');
      expect(section?.to).toBe('/riku/snippets');
    });

    it('resolves section info by short alias', () => {
      const section = getAppSectionByPath('/nav');
      expect(section?.key).toBe('navigation');
      expect(section?.to).toBe('/riku/nav');
    });
  });
});
