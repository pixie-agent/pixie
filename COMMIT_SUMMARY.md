# Git Commit Summary

## Branch: `feature/builtin-default-and-icon`

### Commit: `0e1191e`
**Title:** feat: make builtin engine default with Pixie branding

## Changes Summary

### 📦 Files Changed (8 files, +360/-66 lines)

#### New Files (2)
- `ENGINE_DEFAULT_AND_ICON_CHANGES.md` - Detailed documentation of all changes
- `src/assets/engine-icons/builtin.svg` - Pixie's glowing orb icon

#### Modified Files (6)
1. `src-tauri/Cargo.lock` - Version bump to v0.8.0-beta.4, add native-tls deps
2. `src-tauri/src/engine/builtin/mod.rs` - Model resolution fix and engine simplification
3. `src/components/EngineBadge.tsx` - Add Pixie icon support
4. `src/components/LoopTasksPanel.tsx` - Default to builtin engine
5. `src/hooks/useChat.ts` - Default conversations/tasks to builtin
6. `src/lib/storage.ts` - Change default engine to builtin

## Key Features

### ✅ Default Engine
- **New users**: Automatically start with Builtin engine
- **Existing users**: New conversations default to Builtin
- **Consistency**: All fallback logic uses "builtin"

### ✅ Pixie Branding
- **Icon**: Custom glowing pixie orb with wings and spark dust
- **Colors**: Violet/purple scheme matching Pixie brand (#a78bfa, #f3e8ff)
- **Abbreviation**: "Px" for builtin engine

### ✅ Bug Fix
- **Problem**: Builtin engine returned empty responses
- **Root cause**: "builtin" placeholder used as model ID instead of real Anthropic model
- **Solution**: Fixed model resolution to use real model IDs (claude-sonnet-4-20250514)

## Technical Details

### Frontend Changes
```typescript
// Before: defaultEngine: "claude"
// After:  defaultEngine: "builtin"

// Before: knownReadyEngines: []
// After:  knownReadyEngines: ["builtin"]

// Engine badge: Added Pixie icon and "Px" abbreviation
```

### Backend Changes
```rust
// Before: get_model() returns DEFAULT_MODEL = "claude-sonnet-4-6"
// After:  get_model() returns "claude-sonnet-4-20250514" or reads from config

// Fixed: resolve_builtin_model() handles "builtin" placeholder correctly
```

## Testing Checklist

- [x] Code compiles without errors
- [x] Commit message is clear and detailed
- [x] All related files are included
- [ ] Build and run the application
- [ ] Test builtin engine responses
- [ ] Verify icon display in UI
- [ ] Check default engine behavior

## Next Steps

1. **Test**: Build the application and verify:
   - Builtin engine works and returns proper responses
   - Pixie icon displays correctly in all places
   - New conversations default to builtin engine

2. **Merge**: After testing, merge to `beta` branch:
   ```bash
   git checkout beta
   git merge feature/builtin-default-and-icon
   ```

3. **Deploy**: If everything works, tag and release as beta.5

## Untracked Files (Not Committed)

The following documentation and script files remain untracked:
- `BUILTIN_ENGINE_QUICK_REFERENCE.md`
- `MODEL_ID_FALLBACK_FIX.md`
- `MODEL_RESOLUTION_FLOW.md`
- `MODEL_SIMPLIFICATION.md`
- `REGISTRY_EXPLANATION.md`
- `SUMMARY_MODEL_ID_FIX.md`
- `TEST_MODEL_ID_FALLBACK.md`
- `docs/quick_manual_release_beta4.md`
- `scripts/auto_beta4_release.sh`
- `scripts/create_beta4_release_with_token.sh`
- `scripts/manual_beta4_release.sh`

These can be added later if needed for documentation purposes.
