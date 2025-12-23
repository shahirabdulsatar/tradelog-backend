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
app.post('/api/plaid/create_link_token', async (req, res) => {
  console.log('Creating link token...');

  const request = {
    user: {
      client_user_id: req.body.user_id || 'tradelog_user_' + Date.now()
    },
    client_name: "TradeLog",
    products: ['investments'],
    country_codes: ['US'],
    language: 'en',
    redirect_uri: 'https://tradelog-backend-production.up.railway.app/plaid/redirect',
    investments: {
      allow_unverified_crypto_wallets: false,
      allow_manual_entry: false
    }
  };

  try {
    const response = await client.linkTokenCreate(request);
    console.log('Link token created successfully');
    res.json({
      link_token: response.data.link_token,
      expiration: response.data.expiration
    });
  } catch (error) {
    console.error('Link token creation failed:', error.response?.data || error.message);
    res.status(500).json({
      error: error.message,
      details: error.response?.data || 'Failed to create link token'
    });
  }
});

// Alternative endpoint with hyphen (in case iOS is calling this)
app.post('/api/plaid/create-link-token', async (req, res) => {
  console.log('Creating link token via alternative endpoint...');

  const request = {
    user: {
      client_user_id: req.body.user_id || 'tradelog_user_' + Date.now()
    },
    client_name: "TradeLog",
    products: ['investments'],
    country_codes: ['US'],
    language: 'en',
    redirect_uri: 'https://tradelog-backend-production.up.railway.app/plaid/redirect',
    investments: {
      allow_unverified_crypto_wallets: false,
      allow_manual_entry: false
    }
  };

  try {
    const response = await client.linkTokenCreate(request);
    console.log('Link token created successfully (alternative endpoint)');
    res.json({
      link_token: response.data.link_token,
      expiration: response.data.expiration
    });
  } catch (error) {
    console.error('Link token creation failed:', error.response?.data || error.message);
    res.status(500).json({
      error: error.message,
      details: error.response?.data || 'Failed to create link token'
    });
  }
});

// Exchange public token for access token
app.post('/api/plaid/exchange_public_token', async (req, res) => {
  console.log('Exchanging public token...');

  try {
    const { public_token } = req.body;

    if (!public_token) {
      return res.status(400).json({ error: 'public_token is required' });
    }

    const response = await client.itemPublicTokenExchange({
      public_token: public_token,
    });

    console.log('Token exchange successful');
    res.json({
      access_token: response.data.access_token,
      item_id: response.data.item_id
    });
  } catch (error) {
    console.error('Token exchange failed:', error.response?.data || error.message);
    res.status(500).json({
      error: error.message,
      details: error.response?.data || 'Failed to exchange token'
    });
  }
});

// Get investment holdings
app.post('/api/plaid/investments/holdings', async (req, res) => {
  console.log('Fetching investment holdings...');

  try {
    const { access_tokens } = req.body;

    if (!access_tokens || !Array.isArray(access_tokens)) {
      return res.status(400).json({ error: 'access_tokens array is required' });
    }

    console.log(`Fetching holdings for ${access_tokens.length} account(s)`);

    const promises = access_tokens.map(token =>
      client.investmentsHoldingsGet({ access_token: token })
    );

    const responses = await Promise.all(promises);

    // Combine all data from multiple accounts
    const accounts = responses.flatMap(r => r.data.accounts);
    const holdings = responses.flatMap(r => r.data.holdings);
    const securities = responses.flatMap(r => r.data.securities);

    console.log(`Holdings fetched: ${holdings.length} holdings, ${securities.length} securities`);

    res.json({
      accounts,
      holdings,
      securities,
      total_accounts: accounts.length,
      total_holdings: holdings.length
    });
  } catch (error) {
    console.error('Holdings fetch failed:', error.response?.data || error.message);
    res.status(500).json({
      error: error.message,
      details: error.response?.data || 'Failed to fetch holdings'
    });
  }
});

// Get investment transactions
app.post('/api/plaid/investments/transactions', async (req, res) => {
  console.log('Fetching investment transactions...');

  try {
    const { access_tokens, start_date, end_date } = req.body;

    if (!access_tokens || !Array.isArray(access_tokens)) {
      return res.status(400).json({ error: 'access_tokens array is required' });
    }

    if (!start_date || !end_date) {
      return res.status(400).json({ error: 'start_date and end_date are required' });
    }

    console.log(`Fetching transactions from ${start_date} to ${end_date} for ${access_tokens.length} account(s)`);

    const promises = access_tokens.map(token =>
      client.investmentsTransactionsGet({
        access_token: token,
        start_date,
        end_date
      })
    );

    const responses = await Promise.all(promises);

    // Combine all data from multiple accounts
    const accounts = responses.flatMap(r => r.data.accounts);
    const investment_transactions = responses.flatMap(r => r.data.investment_transactions);
    const securities = responses.flatMap(r => r.data.securities);

    console.log(`Transactions fetched: ${investment_transactions.length} transactions`);

    res.json({
      accounts,
      investment_transactions,
      securities,
      total_investment_transactions: investment_transactions.length,
      date_range: { start_date, end_date }
    });
  } catch (error) {
    console.error('Transactions fetch failed:', error.response?.data || error.message);
    res.status(500).json({
      error: error.message,
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
      'POST /api/plaid/create_link_token',
      'POST /api/plaid/create-link-token',
      'POST /api/plaid/exchange_public_token',
      'POST /api/plaid/investments/holdings',
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