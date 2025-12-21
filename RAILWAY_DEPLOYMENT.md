# Railway Deployment Guide

## Step 1: Create Railway Account
1. Go to [railway.app](https://railway.app)
2. Sign up with GitHub (recommended for easy repository connection)

## Step 2: Deploy Your Backend
1. Click "New Project" in Railway dashboard
2. Select "Deploy from GitHub repo"
3. Connect your GitHub account if not already connected
4. Select this repository or create a new repository and push this code

## Step 3: Configure Environment Variables
In Railway dashboard, go to your project → Variables tab and add:
```
PLAID_CLIENT_ID=your_actual_plaid_client_id
PLAID_SECRET=your_actual_plaid_secret_key
NODE_ENV=production
PORT=3000
```

## Step 4: Get Your Backend URL
After deployment, Railway will provide a URL like:
```
https://your-app-name-production.up.railway.app
```

## Step 5: Update iOS App
Update `TradeLog/PlaidConfig.swift` with your Railway URL:
```swift
static let serverBaseURL: String = "https://your-app-name-production.up.railway.app"
```

## Alternative: Push to GitHub First
If you don't have this in GitHub yet:
```bash
# Initialize git repository (already done)
git add .
git commit -m "Initial Plaid backend setup for Railway deployment"

# Create repository on GitHub and push
git remote add origin https://github.com/yourusername/tradelog-backend.git
git branch -M main
git push -u origin main
```

Then follow steps 1-5 above.