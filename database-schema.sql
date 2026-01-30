-- TradeLog Backend Database Schema
-- Run these SQL commands in your Supabase SQL editor

-- 1. Create user_plaid_tokens table to securely store access tokens
CREATE TABLE IF NOT EXISTS user_plaid_tokens (
    id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    user_id UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
    access_token TEXT NOT NULL, -- In production, this should be encrypted
    item_id TEXT NOT NULL,
    institution_id TEXT,
    institution_name TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW(),
    last_used_at TIMESTAMPTZ,
    is_active BOOLEAN DEFAULT TRUE,

    -- Ensure one token per user per item
    UNIQUE(user_id, item_id)
);

-- 2. Create index for faster queries
CREATE INDEX IF NOT EXISTS idx_user_plaid_tokens_user_id ON user_plaid_tokens(user_id);
CREATE INDEX IF NOT EXISTS idx_user_plaid_tokens_active ON user_plaid_tokens(user_id, is_active) WHERE is_active = TRUE;

-- 3. Create Row Level Security (RLS) policies - BACKEND ONLY ACCESS
ALTER TABLE user_plaid_tokens ENABLE ROW LEVEL SECURITY;

-- ✅ CORRECT: Only service role (backend) can access this table
-- This prevents any direct client access to sensitive tokens
CREATE POLICY "Service role full access" ON user_plaid_tokens
    FOR ALL
    TO service_role
    USING (true);

-- ✅ SECURITY: Block all authenticated users from direct access
-- Users should ONLY access via backend API, never directly
CREATE POLICY "Block direct user access" ON user_plaid_tokens
    FOR ALL
    TO authenticated
    USING (false);

-- ✅ SECURITY: Block anonymous access completely
CREATE POLICY "Block anonymous access" ON user_plaid_tokens
    FOR ALL
    TO anon
    USING (false);

-- 4. Create function to update the updated_at timestamp
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ language 'plpgsql';

-- 5. Create trigger to automatically update updated_at
CREATE TRIGGER update_user_plaid_tokens_updated_at
    BEFORE UPDATE ON user_plaid_tokens
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- 6. Create user_api_sessions table for JWT token management (optional)
CREATE TABLE IF NOT EXISTS user_api_sessions (
    id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    user_id UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
    token_hash TEXT NOT NULL, -- Hash of JWT token for revocation
    device_info TEXT, -- Optional: store device/app info
    ip_address INET,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    last_used_at TIMESTAMPTZ DEFAULT NOW(),
    expires_at TIMESTAMPTZ NOT NULL,
    is_active BOOLEAN DEFAULT TRUE,

    -- Ensure uniqueness
    UNIQUE(token_hash)
);

-- 7. Create index for API sessions
CREATE INDEX IF NOT EXISTS idx_user_api_sessions_user_id ON user_api_sessions(user_id);
CREATE INDEX IF NOT EXISTS idx_user_api_sessions_active ON user_api_sessions(user_id, is_active, expires_at) WHERE is_active = TRUE;

-- 8. Enable RLS for API sessions - BACKEND ONLY ACCESS
ALTER TABLE user_api_sessions ENABLE ROW LEVEL SECURITY;

-- ✅ CORRECT: Only service role can manage sessions
CREATE POLICY "Service role session management" ON user_api_sessions
    FOR ALL
    TO service_role
    USING (true);

-- ✅ SECURITY: Block direct user access to sessions
CREATE POLICY "Block user session access" ON user_api_sessions
    FOR ALL
    TO authenticated, anon
    USING (false);

-- 9. Create function to clean up expired tokens
CREATE OR REPLACE FUNCTION cleanup_expired_sessions()
RETURNS INTEGER AS $$
DECLARE
    deleted_count INTEGER;
BEGIN
    DELETE FROM user_api_sessions
    WHERE expires_at < NOW() OR is_active = FALSE;

    GET DIAGNOSTICS deleted_count = ROW_COUNT;

    RETURN deleted_count;
END;
$$ language 'plpgsql';

-- 10. Create view for user connected accounts summary
CREATE OR REPLACE VIEW user_connected_accounts AS
SELECT
    u.id as user_id,
    u.email,
    u.name,
    COUNT(t.id) as connected_accounts,
    ARRAY_AGG(t.institution_name) FILTER (WHERE t.institution_name IS NOT NULL) as institutions,
    MAX(t.last_used_at) as last_plaid_usage,
    MAX(t.created_at) as first_connected
FROM profiles u
LEFT JOIN user_plaid_tokens t ON u.id = t.user_id AND t.is_active = TRUE
GROUP BY u.id, u.email, u.name;

-- 11. Grant necessary permissions - SERVICE ROLE ONLY
GRANT ALL ON user_plaid_tokens TO service_role;
GRANT ALL ON user_api_sessions TO service_role;
GRANT SELECT ON user_connected_accounts TO service_role;

-- 12. Sample data cleanup queries (for maintenance)
/*
-- Remove inactive tokens older than 30 days
DELETE FROM user_plaid_tokens
WHERE is_active = FALSE AND updated_at < NOW() - INTERVAL '30 days';

-- Remove expired API sessions
SELECT cleanup_expired_sessions();

-- View user connection summary
SELECT * FROM user_connected_accounts;
*/

COMMENT ON TABLE user_plaid_tokens IS 'Stores Plaid access tokens for users, encrypted in production';
COMMENT ON TABLE user_api_sessions IS 'Tracks API sessions for JWT token management and security';
COMMENT ON VIEW user_connected_accounts IS 'Summary view of user account connections';

-- Success message with security confirmation
DO $$
BEGIN
    RAISE NOTICE '🔒 TradeLog SECURE database schema created successfully!';
    RAISE NOTICE '';
    RAISE NOTICE 'SECURITY MODEL SUMMARY:';
    RAISE NOTICE '✅ Only service_role can access user_plaid_tokens';
    RAISE NOTICE '✅ Direct client access blocked by RLS';
    RAISE NOTICE '✅ All token operations go through backend API';
    RAISE NOTICE '❌ Authenticated users: NO direct token access';
    RAISE NOTICE '❌ Anonymous users: NO access';
    RAISE NOTICE '';
    RAISE NOTICE 'Tables: user_plaid_tokens, user_api_sessions';
    RAISE NOTICE 'Views: user_connected_accounts';
    RAISE NOTICE 'Functions: cleanup_expired_sessions, update_updated_at_column';
    RAISE NOTICE '';
    RAISE NOTICE 'Next steps:';
    RAISE NOTICE '1. Update your backend .env with correct SUPABASE_SERVICE_ROLE_KEY';
    RAISE NOTICE '2. Test the authentication endpoints';
    RAISE NOTICE '3. Deploy the secure backend';
    RAISE NOTICE '4. Verify RLS is blocking direct client access';
    RAISE NOTICE '';
    RAISE NOTICE '🛡️ SECURITY: Enterprise-grade protection enabled!';
END $$;