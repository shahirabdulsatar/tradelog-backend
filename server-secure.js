const express = require('express');
const { Configuration, PlaidApi, PlaidEnvironments } = require('plaid');
const cors = require('cors');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
const compression = require('compression');
const morgan = require('morgan');
const jwt = require('jsonwebtoken');
const bcrypt = require('bcryptjs');
const { body, validationResult } = require('express-validator');
const { createClient } = require('@supabase/supabase-js');
require('dotenv').config();

const app = express();

// =======================
// SECURITY MIDDLEWARE
// =======================

// Helmet for security headers
app.use(helmet({
  crossOriginEmbedderPolicy: false, // Allow embedding for development
}));

// Compression
app.use(compression());

// Logging
app.use(morgan('combined'));

// Rate limiting
const limiter = rateLimit({
  windowMs: parseInt(process.env.RATE_LIMIT_WINDOW_MS) || 15 * 60 * 1000, // 15 minutes
  max: parseInt(process.env.RATE_LIMIT_MAX_REQUESTS) || 100, // limit each IP to 100 requests per windowMs
  message: {
    error: 'RATE_LIMIT_EXCEEDED',
    message: 'Too many requests from this IP, please try again later.',
  },
  standardHeaders: true, // Return rate limit info in the `RateLimit-*` headers
  legacyHeaders: false, // Disable the `X-RateLimit-*` headers
});

app.use('/api', limiter);

// CORS configuration
const corsOptions = {
  origin: function (origin, callback) {
    // Allow requests with no origin (like mobile apps or curl requests)
    if (!origin) return callback(null, true);

    const allowedOrigins = process.env.ALLOWED_ORIGINS ?
      process.env.ALLOWED_ORIGINS.split(',').map(s => s.trim()) :
      ['tradelog://'];

    if (allowedOrigins.includes(origin)) {
      callback(null, true);
    } else {
      callback(new Error('Not allowed by CORS'));
    }
  },
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization'],
};

app.use(cors(corsOptions));
app.use(express.json({ limit: '10mb' }));

// =======================
// EXTERNAL SERVICE CLIENTS
// =======================

// Plaid client configuration
const getPlaidEnvironment = () => {
  switch (process.env.PLAID_ENV) {
    case 'production': return PlaidEnvironments.production;
    case 'development': return PlaidEnvironments.development;
    default: return PlaidEnvironments.sandbox;
  }
};

const plaidConfig = new Configuration({
  basePath: getPlaidEnvironment(),
  baseOptions: {
    headers: {
      'PLAID-CLIENT-ID': process.env.PLAID_CLIENT_ID,
      'PLAID-SECRET': process.env.PLAID_SECRET,
      'Plaid-Version': '2020-09-14',
    },
  },
});

const plaidClient = new PlaidApi(plaidConfig);

// Supabase client configuration
const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY // Use service role key for backend operations
);

// =======================
// AUTHENTICATION MIDDLEWARE
// =======================

const authenticateToken = async (req, res, next) => {
  const authHeader = req.headers['authorization'];
  const token = authHeader && authHeader.split(' ')[1]; // Bearer TOKEN

  if (!token) {
    return res.status(401).json({
      error: 'AUTHENTICATION_REQUIRED',
      message: 'Access token is required'
    });
  }

  try {
    // Verify JWT token
    const decoded = jwt.verify(token, process.env.JWT_SECRET);

    // Verify user exists in Supabase
    const { data: user, error } = await supabase
      .from('profiles')
      .select('id, email, name')
      .eq('id', decoded.userId)
      .single();

    if (error || !user) {
      return res.status(401).json({
        error: 'INVALID_TOKEN',
        message: 'Token is invalid or user not found'
      });
    }

    // Add user info to request
    req.user = {
      id: user.id,
      email: user.email,
      name: user.name
    };

    next();
  } catch (error) {
    console.error('Token verification failed:', error.message);
    return res.status(401).json({
      error: 'TOKEN_VERIFICATION_FAILED',
      message: 'Failed to verify access token'
    });
  }
};

// =======================
// VALIDATION MIDDLEWARE
// =======================

const validateErrors = (req, res, next) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    return res.status(400).json({
      error: 'VALIDATION_ERROR',
      details: errors.array()
    });
  }
  next();
};

// =======================
// UTILITY FUNCTIONS
// =======================

const generateJWT = (userId) => {
  return jwt.sign(
    { userId },
    process.env.JWT_SECRET,
    { expiresIn: process.env.JWT_EXPIRES_IN || '7d' }
  );
};

const logRequest = (req, action) => {
  console.log(`🔒 [${new Date().toISOString()}] ${action} - User: ${req.user?.id || 'Anonymous'} - IP: ${req.ip}`);
};

// =======================
// PUBLIC ENDPOINTS
// =======================

// Health check endpoint
app.get('/', (req, res) => {
  res.json({
    message: 'TradeLog Secure Backend is running!',
    status: 'healthy',
    timestamp: new Date().toISOString(),
    environment: process.env.NODE_ENV || 'development',
    version: '2.0.0',
    security: 'enabled'
  });
});

app.get('/health', (req, res) => {
  res.status(200).json({
    status: 'OK',
    uptime: process.uptime(),
    timestamp: new Date().toISOString(),
    plaid_configured: !!(process.env.PLAID_CLIENT_ID && process.env.PLAID_SECRET),
    supabase_configured: !!(process.env.SUPABASE_URL && process.env.SUPABASE_SERVICE_ROLE_KEY),
    jwt_configured: !!process.env.JWT_SECRET
  });
});

// =======================
// AUTHENTICATION ENDPOINTS
// =======================

// Login/Create JWT token endpoint
app.post('/api/auth/login', [
  body('userId').isUUID().withMessage('Valid user ID is required'),
  body('email').isEmail().withMessage('Valid email is required'),
], validateErrors, async (req, res) => {
  try {
    const { userId, email } = req.body;

    // Verify user exists in Supabase
    const { data: user, error } = await supabase
      .from('profiles')
      .select('id, email, name')
      .eq('id', userId)
      .eq('email', email)
      .single();

    if (error || !user) {
      return res.status(401).json({
        error: 'USER_NOT_FOUND',
        message: 'User not found or invalid credentials'
      });
    }

    // Generate JWT token
    const token = generateJWT(userId);

    console.log(`✅ User authenticated: ${user.name} (${user.email})`);

    res.json({
      token,
      user: {
        id: user.id,
        email: user.email,
        name: user.name
      },
      expires_in: process.env.JWT_EXPIRES_IN || '7d'
    });

  } catch (error) {
    console.error('Authentication error:', error.message);
    res.status(500).json({
      error: 'AUTHENTICATION_ERROR',
      message: 'Failed to authenticate user'
    });
  }
});

// Token validation endpoint
app.get('/api/auth/validate', authenticateToken, (req, res) => {
  res.json({
    valid: true,
    user: req.user
  });
});

// =======================
// SECURE PLAID ENDPOINTS
// =======================

// Create Plaid Link Token (Secure)
app.post('/api/plaid/create-link-token', [
  body('user_id').optional().isString(),
  body('redirect_uri').optional().isURL(),
], validateErrors, authenticateToken, async (req, res) => {
  try {
    logRequest(req, 'CREATE_LINK_TOKEN');

    const linkTokenConfig = {
      user: {
        client_user_id: req.user.id // Use authenticated user's ID
      },
      client_name: "TradeLog",
      products: ['investments'],
      country_codes: ['US'],
      language: 'en'
    };

    // Add redirect URI if provided
    const redirectUri = req.body.redirect_uri || 'tradelog://plaid-success';
    if (redirectUri) {
      linkTokenConfig.redirect_uri = redirectUri;
    }

    // Investment configuration
    linkTokenConfig.investments = {
      allow_unverified_crypto_wallets: false,
      allow_manual_entry: false
    };

    const response = await plaidClient.linkTokenCreate(linkTokenConfig);

    console.log(`✅ Link token created for user: ${req.user.name}`);

    res.json({
      link_token: response.data.link_token,
      expiration: response.data.expiration,
      request_id: response.data.request_id
    });

  } catch (error) {
    console.error('❌ Link token creation failed:', error.message);
    res.status(500).json({
      error: 'LINK_TOKEN_CREATE_FAILED',
      message: 'Failed to create link token',
      display_message: 'Unable to connect to Plaid. Please try again.'
    });
  }
});

// Exchange Public Token for Access Token (Secure)
app.post('/api/plaid/exchange-public-token', [
  body('public_token').notEmpty().withMessage('Public token is required'),
], validateErrors, authenticateToken, async (req, res) => {
  try {
    logRequest(req, 'EXCHANGE_PUBLIC_TOKEN');

    const { public_token } = req.body;

    const response = await plaidClient.itemPublicTokenExchange({
      public_token,
    });

    const { access_token, item_id } = response.data;

    // Store access token securely in Supabase linked to user
    const { error: dbError } = await supabase
      .from('user_plaid_tokens')
      .upsert({
        user_id: req.user.id,
        access_token: access_token, // In production, encrypt this
        item_id: item_id,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString()
      }, {
        onConflict: 'user_id,item_id'
      });

    if (dbError) {
      console.error('Failed to store access token:', dbError);
      // Don't fail the request, but log the error
    }

    console.log(`✅ Token exchanged and stored for user: ${req.user.name}`);

    res.json({
      success: true,
      item_id,
      message: 'Account connected successfully'
    });

  } catch (error) {
    console.error('❌ Token exchange failed:', error.message);
    res.status(500).json({
      error: 'TOKEN_EXCHANGE_FAILED',
      message: 'Failed to exchange token',
      display_message: 'Failed to complete account connection. Please try again.'
    });
  }
});

// Get Investment Holdings (Secure)
app.get('/api/plaid/investments/holdings', authenticateToken, async (req, res) => {
  try {
    logRequest(req, 'GET_INVESTMENTS_HOLDINGS');

    // Get user's access tokens from database
    const { data: tokens, error } = await supabase
      .from('user_plaid_tokens')
      .select('access_token, item_id')
      .eq('user_id', req.user.id);

    if (error || !tokens || tokens.length === 0) {
      return res.status(404).json({
        error: 'NO_CONNECTED_ACCOUNTS',
        message: 'No connected accounts found',
        display_message: 'Please connect an account first.'
      });
    }

    console.log(`📊 Fetching holdings for ${tokens.length} account(s) for user: ${req.user.name}`);

    // Fetch holdings for each access token
    const holdingPromises = tokens.map(async (tokenInfo, index) => {
      try {
        const response = await plaidClient.investmentsHoldingsGet({
          access_token: tokenInfo.access_token
        });
        console.log(`✅ Holdings fetched for account ${index + 1}: ${response.data.holdings.length} holdings`);
        return response;
      } catch (error) {
        console.error(`❌ Failed to fetch holdings for account ${index + 1}:`, error.response?.data || error.message);
        // Don't throw, just return null so we can filter it out
        return null;
      }
    });

    const responses = await Promise.all(holdingPromises);
    const validResponses = responses.filter(r => r !== null);

    if (validResponses.length === 0) {
      return res.status(500).json({
        error: 'ALL_ACCOUNTS_FAILED',
        message: 'Failed to fetch data from all connected accounts',
        display_message: 'Unable to fetch your investment data. Please try again.'
      });
    }

    // Combine all data from multiple accounts
    const accounts = validResponses.flatMap(r => r.data.accounts);
    const holdings = validResponses.flatMap(r => r.data.holdings);
    const securities = validResponses.flatMap(r => r.data.securities);

    console.log(`🎯 Holdings aggregated for ${req.user.name}: ${holdings.length} holdings, ${securities.length} securities`);

    res.json({
      accounts,
      holdings,
      securities,
      total_accounts: accounts.length,
      total_holdings: holdings.length,
      request_id: validResponses[0]?.data.request_id,
      fetched_accounts: validResponses.length,
      total_connected_accounts: tokens.length
    });

  } catch (error) {
    console.error('❌ Holdings fetch failed:', error.message);
    res.status(500).json({
      error: 'HOLDINGS_FETCH_FAILED',
      message: 'Failed to fetch investment holdings',
      display_message: 'Unable to fetch your investment data. Please try again.'
    });
  }
});

// Get Investment Transactions (Secure)
app.post('/api/plaid/investments/transactions', [
  body('start_date').matches(/^\d{4}-\d{2}-\d{2}$/).withMessage('start_date must be in YYYY-MM-DD format'),
  body('end_date').matches(/^\d{4}-\d{2}-\d{2}$/).withMessage('end_date must be in YYYY-MM-DD format'),
], validateErrors, authenticateToken, async (req, res) => {
  try {
    logRequest(req, 'GET_INVESTMENTS_TRANSACTIONS');

    const { start_date, end_date } = req.body;

    // Get user's access tokens from database
    const { data: tokens, error } = await supabase
      .from('user_plaid_tokens')
      .select('access_token, item_id')
      .eq('user_id', req.user.id);

    if (error || !tokens || tokens.length === 0) {
      return res.status(404).json({
        error: 'NO_CONNECTED_ACCOUNTS',
        message: 'No connected accounts found',
        display_message: 'Please connect an account first.'
      });
    }

    console.log(`📈 Fetching transactions from ${start_date} to ${end_date} for ${tokens.length} account(s) for user: ${req.user.name}`);

    // Fetch transactions for each access token
    const transactionPromises = tokens.map(async (tokenInfo, index) => {
      try {
        const response = await plaidClient.investmentsTransactionsGet({
          access_token: tokenInfo.access_token,
          start_date,
          end_date
        });
        console.log(`✅ Transactions fetched for account ${index + 1}: ${response.data.investment_transactions.length} transactions`);
        return response;
      } catch (error) {
        console.error(`❌ Failed to fetch transactions for account ${index + 1}:`, error.response?.data || error.message);
        return null;
      }
    });

    const responses = await Promise.all(transactionPromises);
    const validResponses = responses.filter(r => r !== null);

    if (validResponses.length === 0) {
      return res.status(500).json({
        error: 'ALL_ACCOUNTS_FAILED',
        message: 'Failed to fetch transactions from all connected accounts',
        display_message: 'Unable to fetch your transaction data. Please try again.'
      });
    }

    // Combine all data from multiple accounts
    const accounts = validResponses.flatMap(r => r.data.accounts);
    const investment_transactions = validResponses.flatMap(r => r.data.investment_transactions);
    const securities = validResponses.flatMap(r => r.data.securities);

    console.log(`🎯 Transactions aggregated for ${req.user.name}: ${investment_transactions.length} transactions`);

    res.json({
      accounts,
      investment_transactions,
      securities,
      total_investment_transactions: investment_transactions.length,
      date_range: { start_date, end_date },
      request_id: validResponses[0]?.data.request_id,
      fetched_accounts: validResponses.length,
      total_connected_accounts: tokens.length
    });

  } catch (error) {
    console.error('❌ Transactions fetch failed:', error.message);
    res.status(500).json({
      error: 'TRANSACTIONS_FETCH_FAILED',
      message: 'Failed to fetch investment transactions',
      display_message: 'Unable to fetch your transaction history. Please try again.'
    });
  }
});

// =======================
// LEGACY ENDPOINTS (For Backward Compatibility)
// =======================

// Legacy endpoints redirect to secure versions with deprecation warnings
const legacyWarning = (req, res, next) => {
  console.warn(`⚠️ DEPRECATED: ${req.path} - Please use authenticated endpoints`);
  res.header('X-Deprecated', 'true');
  res.header('X-Migration-Info', 'Please update to use /api/plaid/* endpoints with authentication');
  next();
};

app.post('/api/create_link_token', legacyWarning, (req, res) => {
  res.status(401).json({
    error: 'DEPRECATED_ENDPOINT',
    message: 'This endpoint requires authentication. Please use /api/plaid/create-link-token with an Authorization header.',
    migration_guide: 'https://docs.tradelog.com/migration'
  });
});

app.post('/api/exchange_public_token', legacyWarning, (req, res) => {
  res.status(401).json({
    error: 'DEPRECATED_ENDPOINT',
    message: 'This endpoint requires authentication. Please use /api/plaid/exchange-public-token with an Authorization header.',
    migration_guide: 'https://docs.tradelog.com/migration'
  });
});

// =======================
// OAuth REDIRECT AND UNIVERSAL LINKS
// =======================

app.get('/plaid/redirect', (req, res) => {
  console.log('🔗 OAuth redirect received:', req.query);

  const redirectHtml = `
    <!DOCTYPE html>
    <html>
    <head>
      <title>TradeLog - Redirecting...</title>
      <meta name="viewport" content="width=device-width, initial-scale=1">
      <style>
        body { font-family: -apple-system, BlinkMacSystemFont, system-ui; text-align: center; padding: 40px; background: #f5f5f7; }
        .container { max-width: 400px; margin: 0 auto; background: white; padding: 30px; border-radius: 12px; box-shadow: 0 4px 20px rgba(0,0,0,0.1); }
        h2 { color: #1d1d1f; margin-bottom: 16px; }
        p { color: #6e6e73; line-height: 1.5; }
        .loading { display: inline-block; width: 20px; height: 20px; border: 2px solid #f3f3f3; border-radius: 50%; border-top: 2px solid #007AFF; animation: spin 1s linear infinite; margin-left: 10px; }
        @keyframes spin { 0% { transform: rotate(0deg); } 100% { transform: rotate(360deg); } }
      </style>
    </head>
    <body>
      <div class="container">
        <h2>🔗 Connection Complete</h2>
        <p>Redirecting you back to TradeLog<span class="loading"></span></p>
        <script>
          setTimeout(() => {
            window.location = 'tradelog://oauth/complete?' + new URLSearchParams(location.search).toString();
          }, 1500);
        </script>
      </div>
    </body>
    </html>
  `;

  res.send(redirectHtml);
});

app.get('/.well-known/apple-app-site-association', (req, res) => {
  const association = {
    applinks: {
      details: [
        {
          appIDs: ["6QW5L7ECF9.shahirabdulsatar.TradeLog"],
          components: [
            {
              "/": "/plaid/*",
              comment: "Matches any URL path starting with /plaid/"
            }
          ]
        }
      ]
    }
  };

  res.set('Content-Type', 'application/json');
  res.json(association);
});

// =======================
// ERROR HANDLING
// =======================

// Global error handler
app.use((err, req, res, next) => {
  console.error('💥 Unhandled error:', err.stack);

  if (err.type === 'entity.parse.failed') {
    return res.status(400).json({
      error: 'INVALID_JSON',
      message: 'Invalid JSON in request body'
    });
  }

  res.status(500).json({
    error: 'INTERNAL_SERVER_ERROR',
    message: 'An unexpected error occurred'
  });
});

// 404 handler
app.use('*', (req, res) => {
  res.status(404).json({
    error: 'ENDPOINT_NOT_FOUND',
    message: `Endpoint ${req.method} ${req.originalUrl} not found`,
    available_endpoints: [
      'GET /',
      'GET /health',
      'POST /api/auth/login',
      'GET /api/auth/validate',
      'POST /api/plaid/create-link-token [AUTH REQUIRED]',
      'POST /api/plaid/exchange-public-token [AUTH REQUIRED]',
      'GET /api/plaid/investments/holdings [AUTH REQUIRED]',
      'POST /api/plaid/investments/transactions [AUTH REQUIRED]'
    ]
  });
});

// =======================
// SERVER STARTUP
// =======================

const PORT = process.env.PORT || 3000;

// Validate required environment variables
const requiredEnvVars = [
  'PLAID_CLIENT_ID',
  'PLAID_SECRET',
  'SUPABASE_URL',
  'SUPABASE_SERVICE_ROLE_KEY',
  'JWT_SECRET'
];

const missingVars = requiredEnvVars.filter(varName => !process.env[varName]);

if (missingVars.length > 0) {
  console.error(`❌ Missing required environment variables: ${missingVars.join(', ')}`);
  console.error('Please check your .env file and ensure all required variables are set.');
  process.exit(1);
}

app.listen(PORT, () => {
  console.log(`🚀 TradeLog Secure Backend v2.0 running on port ${PORT}`);
  console.log(`📊 Environment: ${process.env.NODE_ENV || 'development'}`);
  console.log(`🔑 Plaid Client ID: ${process.env.PLAID_CLIENT_ID ? '✅ Set' : '❌ Missing'}`);
  console.log(`🔐 Plaid Secret: ${process.env.PLAID_SECRET ? '✅ Set (Hidden)' : '❌ Missing'}`);
  console.log(`🏢 Supabase: ${process.env.SUPABASE_URL ? '✅ Connected' : '❌ Missing'}`);
  console.log(`🔒 JWT Secret: ${process.env.JWT_SECRET ? '✅ Configured' : '❌ Missing'}`);
  console.log(`🛡️ Security: Rate Limiting, CORS, Helmet, Authentication ✅`);
  console.log(`📚 API Docs: All endpoints require authentication except /health and /api/auth/login`);
});

module.exports = app;