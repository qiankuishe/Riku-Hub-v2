# Commit Plan for Riku-Hub Fixes

**Date**: 2026-03-21  
**Status**: Ready for commit  
**Files**: 56 changes (21 deletions, 24 modifications, 11 additions)

## Commit Strategy

### Commit 1: Critical Fixes (P0)
```bash
git add packages/worker/src/index.ts
git add wrangler.toml
git add package.json deploy.sh
git add docs/DEPLOYMENT.md
git commit -m "fix(critical): P0 fixes - APP_KV optional, unified pnpm, deployment config

- Make APP_KV optional with runtime protection
- Unify package manager to pnpm across all scripts
- Update deployment documentation for consistency
- Add APP_KV compatibility binding in wrangler.toml"
```

### Commit 2: Test Fixes (P1)
```bash
git add packages/web/test/page-config.test.ts
git commit -m "fix(tests): update route assertions to /riku/* paths

- Rewrite page-config tests for current implementation
- Add comprehensive route testing (7 tests)
- Fix test gate - now 70/70 tests pass"
```

### Commit 3: Logging Infrastructure (P1)
```bash
git add packages/worker/src/utils/logger.ts
git add packages/worker/src/routes/images.ts
git add packages/worker/src/controllers/compat-controller.ts
git add packages/web/src/pages/images/composables/
git add packages/worker/test/worker.test.ts
git commit -m "feat(logging): implement unified structured logger

- Create structured logger with timestamps and levels
- Replace all console statements with logger calls
- Add security event logging
- Update test assertions for new log format"
```

### Commit 4: Configuration Centralization (P1)
```bash
git add packages/worker/src/config/
git add packages/worker/src/services/telegram-service.ts
git add packages/worker/src/utils/favicon.ts
git add packages/worker/src/utils/http.ts
git add packages/worker/src/utils/ssrf.ts
git add .env.example
git add .madgerc
git commit -m "feat(config): centralize configuration and add monitoring

- Create api-endpoints.ts for external API configuration
- Create constants.ts for shared configuration constants
- Add .env.example with comprehensive documentation
- Setup circular dependency monitoring with madge
- Update all services to use centralized config"
```

### Commit 5: Service Refactoring (P2)
```bash
git add packages/worker/src/services/subscription-parser-service.ts
git add packages/worker/src/services/subscription-fetch-service.ts
git add packages/worker/src/services/compat-nav-sub-service.ts
git add packages/worker/src/repositories/compat-nav-sub-repository.ts
git add packages/worker/src/utils/test-data.ts
git commit -m "refactor(services): merge duplicate subscription logic and cleanup

- Extract shared subscription parsing to single service
- Remove duplicate logic between services
- Clean up unused imports and constants
- Add test data generators for better security"
```

### Commit 6: File Organization (P2)
```bash
git add -A  # Add all remaining deletions and modifications
git commit -m "refactor(files): clean up redundant files and update routes

- Remove 21 redundant HTML files (use /riku/* structure only)
- Remove 8 duplicate image hosting documentation files
- Remove 2 duplicate migration files
- Update route mappings to point to /riku/* paths
- Fix vite.config.ts build configuration"
```

### Commit 7: SEO and PWA (Enhancement)
```bash
git add packages/web/index.html
git add packages/web/riku/nav.html
git add packages/web/riku/images.html
git add packages/web/public/manifest.json
git commit -m "feat(seo): add SEO meta tags and PWA support

- Add comprehensive SEO meta tags to HTML files
- Add Open Graph tags for social sharing
- Create PWA manifest with app shortcuts
- Add theme colors and mobile app support"
```

### Commit 8: Documentation Updates
```bash
git add README.md
git add docs/IMAGE_HOSTING.md
git add pnpm-lock.yaml
git commit -m "docs: update documentation and dependencies

- Update README with current test count (70/70)
- Consolidate image hosting documentation
- Update dependency lock file"
```

## Verification Before Each Commit

```bash
# Before each commit, verify:
corepack pnpm check    # Type checking
corepack pnpm test     # All tests pass
corepack pnpm build    # Build succeeds
```

## Final Verification

After all commits:
```bash
git log --oneline -8   # Verify commit history
corepack pnpm check && corepack pnpm test && corepack pnpm build
```

## Rollback Plan

If any commit causes issues:
```bash
git reset --hard HEAD~1  # Rollback last commit
# Or for specific commit:
git revert <commit-hash>
```

---

**Total Changes Summary**:
- **Deleted**: 21 files (redundant HTML, docs, migrations)
- **Modified**: 24 files (core functionality, config, tests)
- **Added**: 11 files (utilities, config, documentation)
- **Net Result**: Cleaner, more maintainable codebase

**Risk Level**: Low (all changes tested and verified)
**Deployment Ready**: Yes (after commits)