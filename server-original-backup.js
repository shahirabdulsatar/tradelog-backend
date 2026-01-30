const express = require('express');
const { Configuration, PlaidApi, PlaidEnvironments } = require('plaid');
const cors = require('cors');
require('dotenv').config();

const app = express();

// Middleware
app.use(cors());
app.use(express.json());

// Plaid configuration
const configuration = new Configuration({
  basePath: PlaidEnvironments.sandbox, // Change to production later
  baseOptions: {
    headers: {
      'PLAID-CLIENT-ID': process.env.PLAID_CLIENT_ID,
      'PLAID-SECRET': process.env.PLAID_SECRET,
      'Plaid-Version': '2020-09-14', // Required for Plaid API
    },
  },
});

const client = new PlaidApi(configuration);

// Health check endpoint
app.get('/', (req, res) => {
  res.json({
    message: 'TradeLog Plaid Backend is running!',
    status: 'healthy',
    timestamp: new Date().toISOString(),
    environment: process.env.NODE_ENV || 'development'
  });
});

// Health check for monitoring
app.get('/health', (req, res) => {
  res.status(200).json({
    status: 'OK',
    uptime: process.uptime(),
    timestamp: new Date().toISOString()
  });
});

// Create link token for Plaid Link (main endpoint)
app.post('/api/create_link_token', async (req, res) => {
  console.log('Creating link token...');
  console.log('Request body:', req.body);

  try {
    const linkTokenConfig = {
      user: {
        client_user_id: req.body.user_id || 'tradelog_user_' + Date.now()
      },
      client_name: "TradeLog",
      products: ['investments'],
      country_codes: ['US'],
      language: 'en'
    };

    // Add redirect URI only if provided
    const redirectUri = req.body.redirect_uri || 'https://tradelog-backend-production.up.railway.app/plaid/redirect';
    if (redirectUri) {
      linkTokenConfig.redirect_uri = redirectUri;
    }

    // Add investment configuration
    linkTokenConfig.investments = {
      allow_unverified_crypto_wallets: false,
      allow_manual_entry: false
    };

    console.log('Link token config:', JSON.stringify(linkTokenConfig, null, 2));

    const response = await client.linkTokenCreate(linkTokenConfig);
    console.log('✅ Link token created successfully');

    res.json({
      link_token: response.data.link_token,
      expiration: response.data.expiration,
      request_id: response.data.request_id
    });
  } catch (error) {
    console.error('❌ Link token creation failed:');
    console.error('Error message:', error.message);
    console.error('Error response:', error.response?.data);
    console.error('Error stack:', error.stack);

    res.status(500).json({
      error: 'LINK_TOKEN_CREATE_FAILED',
      error_message: error.message,
      details: error.response?.data || 'Failed to create link token',
      display_message: 'Unable to connect to Plaid. Please try again.'
    });
  }
});

// Alternative endpoint for iOS compatibility
app.post('/api/plaid/create_link_token', async (req, res) => {
  console.log('Creating link token via /api/plaid/create_link_token endpoint...');

  try {
    const linkTokenConfig = {
      user: {
        client_user_id: req.body.user_id || 'tradelog_user_' + Date.now()
      },
      client_name: "TradeLog",
      products: ['investments'],
      country_codes: ['US'],
      language: 'en'
    };

    // Add redirect URI only if provided
    const redirectUri = req.body.redirect_uri || 'https://tradelog-backend-production.up.railway.app/plaid/redirect';
    if (redirectUri) {
      linkTokenConfig.redirect_uri = redirectUri;
    }

    linkTokenConfig.investments = {
      allow_unverified_crypto_wallets: false,
      allow_manual_entry: false
    };

    const response = await client.linkTokenCreate(linkTokenConfig);
    console.log('✅ Link token created successfully (alternative endpoint)');

    res.json({
      link_token: response.data.link_token,
      expiration: response.data.expiration,
      request_id: response.data.request_id
    });
  } catch (error) {
    console.error('❌ Link token creation failed (alternative endpoint):', error.message);
    console.error('Error response:', error.response?.data);

    res.status(500).json({
      error: 'LINK_TOKEN_CREATE_FAILED',
      error_message: error.message,
      details: error.response?.data || 'Failed to create link token',
      display_message: 'Unable to connect to Plaid. Please try again.'
    });
  }
});

// Exchange public token for access token
app.post('/api/exchange_public_token', async (req, res) => {
  console.log('🔄 Exchanging public token for access token...');
  console.log('Request body:', req.body);

  try {
    const { public_token } = req.body;

    if (!public_token) {
      console.error('❌ Missing public_token in request');
      return res.status(400).json({
        error: 'MISSING_PUBLIC_TOKEN',
        error_message: 'public_token is required',
        display_message: 'Invalid request. Please try connecting again.'
      });
    }

    console.log('📤 Sending token exchange request to Plaid...');
    const response = await client.itemPublicTokenExchange({
      public_token: public_token,
    });

    console.log('✅ Token exchange successful');
    console.log('Response data keys:', Object.keys(response.data));

    res.json({
      access_token: response.data.access_token,
      item_id: response.data.item_id,
      request_id: response.data.request_id
    });
  } catch (error) {
    console.error('❌ Token exchange failed:');
    console.error('Error message:', error.message);
    console.error('Error response:', error.response?.data);
    console.error('Error stack:', error.stack);

    res.status(500).json({
      error: 'TOKEN_EXCHANGE_FAILED',
      error_message: error.message,
      details: error.response?.data || 'Failed to exchange token',
      display_message: 'Failed to complete account connection. Please try again.'
    });
  }
});

// Legacy endpoint for iOS compatibility
app.post('/api/plaid/exchange_public_token', async (req, res) => {
  console.log('🔄 Token exchange via legacy endpoint - redirecting...');

  try {
    const { public_token } = req.body;

    if (!public_token) {
      return res.status(400).json({
        error: 'MISSING_PUBLIC_TOKEN',
        error_message: 'public_token is required'
      });
    }

    const response = await client.itemPublicTokenExchange({
      public_token: public_token,
    });

    console.log('✅ Token exchange successful (legacy endpoint)');
    res.json({
      access_token: response.data.access_token,
      item_id: response.data.item_id,
      request_id: response.data.request_id
    });
  } catch (error) {
    console.error('❌ Token exchange failed (legacy endpoint):', error.message);
    res.status(500).json({
      error: 'TOKEN_EXCHANGE_FAILED',
      error_message: error.message,
      details: error.response?.data || 'Failed to exchange token'
    });
  }
});

// Get investment holdings
app.post('/api/investments/holdings', async (req, res) => {
  console.log('📊 Fetching investment holdings...');
  console.log('Request body:', req.body);

  try {
    const { access_tokens } = req.body;

    if (!access_tokens || !Array.isArray(access_tokens) || access_tokens.length === 0) {
      console.error('❌ Invalid access_tokens provided');
      return res.status(400).json({
        error: 'INVALID_ACCESS_TOKENS',
        error_message: 'access_tokens array is required and must not be empty',
        display_message: 'No connected accounts found. Please connect an account first.'
      });
    }

    console.log(`📈 Fetching holdings for ${access_tokens.length} account(s)...`);

    // Fetch holdings for each access token
    const holdingPromises = access_tokens.map(async (token, index) => {
      try {
        console.log(`🔄 Fetching holdings for token ${index + 1}/${access_tokens.length}`);
        const response = await client.investmentsHoldingsGet({ access_token: token });
        console.log(`✅ Holdings fetched for token ${index + 1}: ${response.data.holdings.length} holdings`);
        return response;
      } catch (error) {
        console.error(`❌ Failed to fetch holdings for token ${index + 1}:`, error.response?.data || error.message);
        throw error;
      }
    });

    const responses = await Promise.all(holdingPromises);

    // Combine all data from multiple accounts
    const accounts = responses.flatMap(r => r.data.accounts);
    const holdings = responses.flatMap(r => r.data.holdings);
    const securities = responses.flatMap(r => r.data.securities);

    console.log(`🎯 Total holdings aggregated: ${holdings.length} holdings, ${securities.length} securities, ${accounts.length} accounts`);

    res.json({
      accounts,
      holdings,
      securities,
      total_accounts: accounts.length,
      total_holdings: holdings.length,
      request_id: responses[0]?.data.request_id
    });
  } catch (error) {
    console.error('❌ Holdings fetch failed:');
    console.error('Error message:', error.message);
    console.error('Error response:', error.response?.data);

    res.status(500).json({
      error: 'HOLDINGS_FETCH_FAILED',
      error_message: error.message,
      details: error.response?.data || 'Failed to fetch investment holdings',
      display_message: 'Unable to fetch your investment data. Please try again.'
    });
  }
});

// Legacy endpoint for iOS compatibility
app.post('/api/plaid/investments/holdings', async (req, res) => {
  console.log('📊 Holdings fetch via legacy endpoint - redirecting...');

  try {
    const { access_tokens } = req.body;

    if (!access_tokens || !Array.isArray(access_tokens)) {
      return res.status(400).json({
        error: 'INVALID_ACCESS_TOKENS',
        error_message: 'access_tokens array is required'
      });
    }

    const responses = await Promise.all(
      access_tokens.map(token => client.investmentsHoldingsGet({ access_token: token }))
    );

    const accounts = responses.flatMap(r => r.data.accounts);
    const holdings = responses.flatMap(r => r.data.holdings);
    const securities = responses.flatMap(r => r.data.securities);

    console.log(`✅ Holdings fetched (legacy): ${holdings.length} holdings`);

    res.json({
      accounts,
      holdings,
      securities,
      total_accounts: accounts.length,
      total_holdings: holdings.length
    });
  } catch (error) {
    console.error('❌ Holdings fetch failed (legacy):', error.message);
    res.status(500).json({
      error: 'HOLDINGS_FETCH_FAILED',
      error_message: error.message,
      details: error.response?.data || 'Failed to fetch holdings'
    });
  }
});

// Get investment transactions
app.post('/api/investments/transactions', async (req, res) => {
  console.log('📈 Fetching investment transactions...');
  console.log('Request body:', req.body);

  try {
    const { access_tokens, start_date, end_date } = req.body;

    if (!access_tokens || !Array.isArray(access_tokens) || access_tokens.length === 0) {
      console.error('❌ Invalid access_tokens provided');
      return res.status(400).json({
        error: 'INVALID_ACCESS_TOKENS',
        error_message: 'access_tokens array is required and must not be empty',
        display_message: 'No connected accounts found. Please connect an account first.'
      });
    }

    if (!start_date || !end_date) {
      console.error('❌ Missing date range parameters');
      return res.status(400).json({
        error: 'MISSING_DATE_RANGE',
        error_message: 'start_date and end_date are required (format: YYYY-MM-DD)',
        display_message: 'Invalid date range provided. Please try again.'
      });
    }

    // Validate date format
    const dateRegex = /^\d{4}-\d{2}-\d{2}$/;
    if (!dateRegex.test(start_date) || !dateRegex.test(end_date)) {
      return res.status(400).json({
        error: 'INVALID_DATE_FORMAT',
        error_message: 'Dates must be in YYYY-MM-DD format',
        display_message: 'Invalid date format provided. Please try again.'
      });
    }

    console.log(`🗓️ Fetching transactions from ${start_date} to ${end_date} for ${access_tokens.length} account(s)`);

    // Fetch transactions for each access token
    const transactionPromises = access_tokens.map(async (token, index) => {
      try {
        console.log(`🔄 Fetching transactions for token ${index + 1}/${access_tokens.length}`);
        const response = await client.investmentsTransactionsGet({
          access_token: token,
          start_date,
          end_date
        });
        console.log(`✅ Transactions fetched for token ${index + 1}: ${response.data.investment_transactions.length} transactions`);
        return response;
      } catch (error) {
        console.error(`❌ Failed to fetch transactions for token ${index + 1}:`, error.response?.data || error.message);
        throw error;
      }
    });

    const responses = await Promise.all(transactionPromises);

    // Combine all data from multiple accounts
    const accounts = responses.flatMap(r => r.data.accounts);
    const investment_transactions = responses.flatMap(r => r.data.investment_transactions);
    const securities = responses.flatMap(r => r.data.securities);

    console.log(`🎯 Total transactions aggregated: ${investment_transactions.length} transactions, ${securities.length} securities`);

    res.json({
      accounts,
      investment_transactions,
      securities,
      total_investment_transactions: investment_transactions.length,
      date_range: { start_date, end_date },
      request_id: responses[0]?.data.request_id
    });
  } catch (error) {
    console.error('❌ Transactions fetch failed:');
    console.error('Error message:', error.message);
    console.error('Error response:', error.response?.data);

    res.status(500).json({
      error: 'TRANSACTIONS_FETCH_FAILED',
      error_message: error.message,
      details: error.response?.data || 'Failed to fetch investment transactions',
      display_message: 'Unable to fetch your transaction history. Please try again.'
    });
  }
});

// Legacy endpoint for iOS compatibility
app.post('/api/plaid/investments/transactions', async (req, res) => {
  console.log('📈 Transactions fetch via legacy endpoint - redirecting...');

  try {
    const { access_tokens, start_date, end_date } = req.body;

    if (!access_tokens || !Array.isArray(access_tokens)) {
      return res.status(400).json({
        error: 'INVALID_ACCESS_TOKENS',
        error_message: 'access_tokens array is required'
      });
    }

    if (!start_date || !end_date) {
      return res.status(400).json({
        error: 'MISSING_DATE_RANGE',
        error_message: 'start_date and end_date are required'
      });
    }

    const responses = await Promise.all(
      access_tokens.map(token => client.investmentsTransactionsGet({
        access_token: token,
        start_date,
        end_date
      }))
    );

    const accounts = responses.flatMap(r => r.data.accounts);
    const investment_transactions = responses.flatMap(r => r.data.investment_transactions);
    const securities = responses.flatMap(r => r.data.securities);

    console.log(`✅ Transactions fetched (legacy): ${investment_transactions.length} transactions`);

    res.json({
      accounts,
      investment_transactions,
      securities,
      total_investment_transactions: investment_transactions.length,
      date_range: { start_date, end_date }
    });
  } catch (error) {
    console.error('❌ Transactions fetch failed (legacy):', error.message);
    res.status(500).json({
      error: 'TRANSACTIONS_FETCH_FAILED',
      error_message: error.message,
      details: error.response?.data || 'Failed to fetch transactions'
    });
  }
});

// Error handling middleware
app.use((err, req, res, next) => {
  console.error('Unhandled error:', err);
  res.status(500).json({
    error: 'Internal server error',
    details: err.message
  });
});

// 404 handler
app.use('*', (req, res) => {
  res.status(404).json({
    error: 'Endpoint not found',
    available_endpoints: [
      'GET /',
      'GET /health',
      'GET /plaid/redirect',
      'GET /.well-known/apple-app-site-association',
      'POST /api/create_link_token',
      'POST /api/plaid/create_link_token',
      'POST /api/exchange_public_token',
      'POST /api/plaid/exchange_public_token',
      'POST /api/investments/holdings',
      'POST /api/plaid/investments/holdings',
      'POST /api/investments/transactions',
      'POST /api/plaid/investments/transactions'
    ]
  });
});

// OAuth redirect endpoint for Universal Links
app.get('/plaid/redirect', (req, res) => {
  console.log('OAuth redirect received:', req.query);

  // Generate a simple redirect page that will open the app
  const redirectHtml = `
    <!DOCTYPE html>
    <html>
    <head>
      <title>TradeLog - Redirecting...</title>
      <meta name="viewport" content="width=device-width, initial-scale=1">
    </head>
    <body style="font-family: -apple-system, system-ui; text-align: center; padding: 40px;">
      <h2>🔗 Connection Complete</h2>
      <p>Redirecting you back to TradeLog...</p>
      <script>
        // Try to redirect back to the app
        setTimeout(() => {
          window.location = 'tradelog://oauth/complete?' + new URLSearchParams(location.search).toString();
        }, 1000);
      </script>
    </body>
    </html>
  `;

  res.send(redirectHtml);
});

// Serve apple-app-site-association for Universal Links
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

const PORT = process.env.PORT || 3000;

app.listen(PORT, () => {
  console.log(`🚀 TradeLog Plaid Backend running on port ${PORT}`);
  console.log(`📊 Environment: ${process.env.NODE_ENV || 'development'}`);
  console.log(`🔑 Plaid Client ID: ${process.env.PLAID_CLIENT_ID ? '✅ Set' : '❌ Missing'}`);
  console.log(`🔐 Plaid Secret: ${process.env.PLAID_SECRET ? '✅ Set' : '❌ Missing'}`);
});