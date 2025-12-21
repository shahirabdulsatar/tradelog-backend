# TradeLog Plaid Backend

Backend server for TradeLog iOS app's Plaid integration.

## 🚀 Quick Setup

1. **Install dependencies:**
   ```bash
   npm install
   ```

2. **Configure environment variables:**
   ```bash
   cp .env.example .env
   # Edit .env with your Plaid API keys
   ```

3. **Run locally:**
   ```bash
   npm start
   ```

## 📱 API Endpoints

- `GET /` - Health check
- `POST /api/plaid/create_link_token` - Create Plaid Link token
- `POST /api/plaid/exchange_public_token` - Exchange public token for access token
- `POST /api/plaid/investments/holdings` - Get investment holdings
- `POST /api/plaid/investments/transactions` - Get investment transactions

## 🔧 Environment Variables

```bash
PLAID_CLIENT_ID=your_plaid_client_id
PLAID_SECRET=your_plaid_secret_key
NODE_ENV=development
PORT=3000
```

## 🚢 Deployment

This backend is ready to deploy to Railway, Heroku, or any Node.js hosting service.

### Railway Deployment:
```bash
railway login
railway init
railway up
```

## 📋 Requirements

- Node.js >= 18.0.0
- Plaid API account and keys
- HTTPS endpoint for production

## 🔒 Security Notes

- Never commit `.env` file
- Use environment variables for all secrets
- Enable CORS only for your iOS app domain in production