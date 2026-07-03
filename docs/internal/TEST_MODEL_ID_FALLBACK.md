# How to Test Model ID Fallback Fix

## Test Scenarios

### Scenario 1: Unknown Model ID
Test that an unknown model ID falls back to being used directly as the model ID.

**Steps:**
1. Set `ANTHROPIC_MODEL` to a model ID that doesn't exist in the builtin registry:
   ```bash
   export ANTHROPIC_MODEL="claude-3-7-custom-model"
   ```
2. Start Pixie and create a conversation with the builtin engine
3. Check the logs for the fallback message:
   ```
   [builtin] pattern 'claude-3-7-custom-model' not found in registry, using as custom model ID
   ```
4. The conversation should use `claude-3-7-custom-model` as the model ID in API calls

### Scenario 2: Known Model ID
Test that known model IDs still work as expected.

**Steps:**
1. Set `ANTHROPIC_MODEL` to a known model:
   ```bash
   export ANTHROPIC_MODEL="sonnet"
   ```
2. Start Pixie and create a conversation with the builtin engine
3. The model should be resolved to `claude-sonnet-4-6` from the registry
4. No fallback message should appear in logs

### Scenario 3: Custom Base URL with Unknown Model
Test that custom base URLs work with unknown model IDs.

**Steps:**
1. Set both custom model and base URL:
   ```bash
   export ANTHROPIC_MODEL="my-custom-model"
   export ANTHROPIC_BASE_URL="https://my-api.example.com"
   ```
2. Start Pixie and create a conversation with the builtin engine
3. Check logs for:
   - Fallback message for the model
   - HTTPS protocol confirmation message
4. API calls should go to `https://my-api.example.com` with model ID `my-custom-model`

### Scenario 4: HTTP Base URL (Local Development)
Test that HTTP URLs work for local development.

**Steps:**
1. Set an HTTP base URL:
   ```bash
   export ANTHROPIC_MODEL="local-model"
   export ANTHROPIC_BASE_URL="http://localhost:8080"
   ```
2. Start Pixie and create a conversation with the builtin engine
3. Check logs for:
   - Fallback message for the model
   - HTTP security warning
4. API calls should go to `http://localhost:8080` with model ID `local-model`

## Expected Behavior

### Before the Fix
- Unknown model IDs would fallback to the first registry model (`claude-sonnet-4-6`)
- Users could not use custom model IDs

### After the Fix
- Unknown model IDs are used directly as the model ID
- Users can now use custom model IDs that aren't in the builtin registry
- This is especially useful for:
  - Private Anthropic deployments with custom model IDs
  - Proxy services with custom model naming
  - Testing with new/experimental models

## Verification

To verify the fix is working:

1. **Check logs** - Look for the fallback message when using an unknown model ID
2. **Monitor API calls** - Verify the correct model ID is being sent to the API
3. **Test conversations** - Ensure conversations complete successfully with custom model IDs
4. **Verify base_url** - Ensure custom base URLs are correctly applied

## Common Issues

### Issue: API returns "model not found"
**Solution:** Verify the custom model ID is valid for your API endpoint. The fix only ensures the model ID is passed through; it doesn't validate that the model exists on the server.

### Issue: Connection errors with custom base URL
**Solution:** Check that the base URL is correct and accessible. For HTTPS URLs, ensure the SSL certificate is valid.

### Issue: HTTP URL still doesn't work
**Solution:** HTTP URLs are only supported for local development. Ensure you're using `native-tls` feature and the server is accessible from your network.
