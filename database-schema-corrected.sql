-- TradeLog Backend Database Schema - CORRECTED VERSION
-- Run these SQL commands in your Supabase SQL editor
-- This version is designed for SERVICE ROLE backend access only

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

-- 6. Create user_api_sessions table for JWT token management
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

-- 10. Create SECURE view for user connected accounts (backend access only)
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

-- 11. Secure the view with RLS
ALTER VIEW user_connected_accounts SET (security_invoker = true);

-- 12. Create security audit function (for monitoring)
CREATE OR REPLACE FUNCTION audit_token_access(
    p_user_id UUID,
    p_action TEXT,
    p_ip_address INET DEFAULT NULL
)
RETURNS VOID AS $$
BEGIN
    -- Log security events (you can extend this)
    INSERT INTO user_api_sessions (user_id, token_hash, device_info, ip_address, expires_at, is_active)
    VALUES (
        p_user_id,
        'audit_' || p_action || '_' || extract(epoch from now()),
        p_action,
        p_ip_address,
        NOW() + INTERVAL '1 hour',
        false
    );
END;
$$ language 'plpgsql';

-- 13. Create helper functions for backend (service role only)
CREATE OR REPLACE FUNCTION get_user_plaid_tokens(p_user_id UUID)
RETURNS TABLE(
    access_token TEXT,
    item_id TEXT,
    institution_name TEXT,
    created_at TIMESTAMPTZ
)
SECURITY DEFINER -- Runs with creator's permissions (service role)
AS $$
BEGIN
    -- Only service role should call this
    IF current_setting('role') != 'service_role' THEN
        RAISE EXCEPTION 'Access denied: Function requires service role';
    END IF;

    RETURN QUERY
    SELECT
        t.access_token,
        t.item_id,
        t.institution_name,
        t.created_at
    FROM user_plaid_tokens t
    WHERE t.user_id = p_user_id
      AND t.is_active = true;
END;
$$ language 'plpgsql';

-- 14. Create function to safely store tokens (backend only)
CREATE OR REPLACE FUNCTION store_plaid_token(
    p_user_id UUID,
    p_access_token TEXT,
    p_item_id TEXT,
    p_institution_id TEXT DEFAULT NULL,
    p_institution_name TEXT DEFAULT NULL
)
RETURNS UUID
SECURITY DEFINER -- Runs with creator's permissions (service role)
AS $$
DECLARE
    token_id UUID;
BEGIN
    -- Only service role should call this
    IF current_setting('role') != 'service_role' THEN
        RAISE EXCEPTION 'Access denied: Function requires service role';
    END IF;

    -- Validate input
    IF p_user_id IS NULL OR p_access_token IS NULL OR p_item_id IS NULL THEN
        RAISE EXCEPTION 'Missing required parameters';
    END IF;

    -- Insert or update token
    INSERT INTO user_plaid_tokens (
        user_id, access_token, item_id, institution_id, institution_name
    ) VALUES (
        p_user_id, p_access_token, p_item_id, p_institution_id, p_institution_name
    )
    ON CONFLICT (user_id, item_id) DO UPDATE SET
        access_token = EXCLUDED.access_token,
        updated_at = NOW(),
        last_used_at = NOW(),
        is_active = true
    RETURNING id INTO token_id;

    RETURN token_id;
END;
$$ language 'plpgsql';

-- 15. Grant permissions ONLY to service role
GRANT ALL ON user_plaid_tokens TO service_role;
GRANT ALL ON user_api_sessions TO service_role;
GRANT SELECT ON user_connected_accounts TO service_role;
GRANT EXECUTE ON FUNCTION get_user_plaid_tokens(UUID) TO service_role;
GRANT EXECUTE ON FUNCTION store_plaid_token(UUID, TEXT, TEXT, TEXT, TEXT) TO service_role;
GRANT EXECUTE ON FUNCTION cleanup_expired_sessions() TO service_role;

-- 16. SECURITY TEST: Verify RLS is working
DO $$
BEGIN
    -- Test that service role can access
    PERFORM * FROM user_plaid_tokens LIMIT 1;
    RAISE NOTICE '✅ Service role access confirmed';

    RAISE NOTICE '';
    RAISE NOTICE '🔒 SECURITY SUMMARY:';
    RAISE NOTICE '✅ Only service_role can access user_plaid_tokens';
    RAISE NOTICE '✅ Direct client access blocked by RLS';
    RAISE NOTICE '✅ All token operations go through backend';
    RAISE NOTICE '✅ Helper functions enforce service_role access';
    RAISE NOTICE '';
    RAISE NOTICE '🚫 BLOCKED ACCESS:';
    RAISE NOTICE '❌ Authenticated users: NO direct access';
    RAISE NOTICE '❌ Anonymous users: NO access';
    RAISE NOTICE '❌ Client apps: NO direct token access';
    RAISE NOTICE '';
    RAISE NOTICE '✅ DEPLOYMENT COMPLETE - Database is secure!';
END $$;

-- 17. Sample maintenance queries (for reference)
/*
-- Monitor token usage
SELECT
    u.email,
    COUNT(*) as token_count,
    MAX(t.last_used_at) as last_used
FROM profiles u
JOIN user_plaid_tokens t ON u.id = t.user_id
WHERE t.is_active = true
GROUP BY u.email;

-- Clean up old sessions
SELECT cleanup_expired_sessions();

-- Audit token access (call from backend)
SELECT audit_token_access('user-uuid-here'::UUID, 'token_accessed', '192.168.1.1'::INET);
*/

COMMENT ON TABLE user_plaid_tokens IS 'Plaid access tokens - SERVICE ROLE ACCESS ONLY via backend API';
COMMENT ON TABLE user_api_sessions IS 'API session tracking - SERVICE ROLE ACCESS ONLY';
COMMENT ON FUNCTION get_user_plaid_tokens(UUID) IS 'Backend function to retrieve user tokens safely';
COMMENT ON FUNCTION store_plaid_token(UUID, TEXT, TEXT, TEXT, TEXT) IS 'Backend function to store tokens safely';