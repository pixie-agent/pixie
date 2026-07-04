# Model ID Fallback Fix

## Problem
When the builtin engine's `resolve_model()` function couldn't match a user-provided model pattern against the builtin registry, it would fallback to the first model in the registry (claude-sonnet-4-6) instead of using the user's intended model ID.

## Solution
Modified `resolve_builtin_model()` in `src-tauri/src/engine/builtin/mod.rs` to fallback to using the user-provided pattern as the model ID directly when no match is found. This allows users to specify custom model IDs that aren't in the builtin registry.

## Changes
- **File**: `src-tauri/src/engine/builtin/mod.rs`
- **Function**: `resolve_builtin_model()`
- **Behavior**:
  1. First, try to resolve the pattern against the builtin model registry
  2. If no match is found, create a new `Model` struct using the pattern as the model ID
  3. Use sensible defaults for the custom model (Anthropic API, 200K context window, Sonnet pricing)

## Example
```rust
// Before:
resolve_builtin_model(Some("my-custom-model"), None)
// Would return: claude-sonnet-4-6 (first in registry)

// After:
resolve_builtin_model(Some("my-custom-model"), None)
// Returns: Model with id="my-custom-model"
```

## Testing
To verify the fix works:
1. Set a custom model ID that doesn't match builtin models
2. Start a conversation with the builtin engine
3. Check logs for: `[builtin] pattern 'xxx' not found in registry, using as custom model ID`
4. The custom model ID should be used in API calls
