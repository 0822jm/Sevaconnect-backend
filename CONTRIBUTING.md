# Contributing to SevaConnect

## Overview

SevaConnect is a monorepo with two parts:
- `backend/` — Express API deployed on Render, database on NeonDB
- `mobile/` — Expo/React Native app built with EAS

Contributors work on their own isolated fork and open PRs when ready. This keeps the main deployment and database safe.

---

## First-Time Setup

### 1. Fork the repos

- Fork **[0822jm/Sevaconnect-backend](https://github.com/0822jm/Sevaconnect-backend)** on GitHub
- Fork **[0822jm/Sevaconnect-app](https://github.com/0822jm/Sevaconnect-app)** on GitHub

Clone your forks locally:
```bash
git clone https://github.com/YOUR_USERNAME/Sevaconnect-backend.git
git clone https://github.com/YOUR_USERNAME/Sevaconnect-app.git
```

Add the originals as `upstream` so you can sync later:
```bash
# in Sevaconnect-backend
git remote add upstream https://github.com/0822jm/Sevaconnect-backend.git

# in Sevaconnect-app
git remote add upstream https://github.com/0822jm/Sevaconnect-app.git
```

---

### 2. Set up your own Backend

#### Create a NeonDB database
1. Sign up at [neon.tech](https://neon.tech) (free tier)
2. Create a new project
3. Copy the connection string from the dashboard

#### Create a Render deployment
1. Sign up at [render.com](https://render.com) (free tier)
2. Create a new **Web Service** linked to your forked `Sevaconnect-backend` repo
3. Set the following environment variables in Render:

```
DATABASE_URL        = your NeonDB connection string
JWT_SECRET          = any long random string
TWILIO_ACCOUNT_SID  = from console.twilio.com (or leave blank to use master OTP only)
TWILIO_AUTH_TOKEN   = from console.twilio.com
TWILIO_VERIFY_SERVICE_SID = from console.twilio.com
TWILIO_MASTER_OTP   = 1234  (use this to bypass real SMS in dev)
PORT                = 3001
```

#### Set up your local backend `.env`
```bash
cd Sevaconnect-backend
cp .env.example .env
# Fill in your own values in .env
```

#### Run the DB migration
```bash
cd Sevaconnect-backend
npm install
npx tsx src/migrate.ts
```

---

### 3. Set up your own Expo Account

1. Create a free account at [expo.dev](https://expo.dev)
2. Install EAS CLI: `npm install -g eas-cli`
3. Log in: `eas login`
4. In your cloned mobile repo, update `app.json`:
   - Change `"owner"` to your Expo username
5. Initialise a new EAS project:
   ```bash
   cd Sevaconnect-app
   eas init
   ```
   This updates `extra.eas.projectId` in `app.json` — **do not commit this change**.

---

### 4. Set up the Mobile App

```bash
cd Sevaconnect-app
npm install
cp .env.example .env.local
```

Edit `.env.local` and set your backend URL:
```
# Point to your own Render deployment
EXPO_PUBLIC_API_URL=https://your-app.onrender.com/api

# Or point to your local backend while developing
# EXPO_PUBLIC_API_URL=http://10.0.2.2:3001/api   (Android emulator)
# EXPO_PUBLIC_API_URL=http://localhost:3001/api   (iOS simulator)
```

Run locally on an emulator:
```bash
npx expo start
# press 'a' for Android emulator, 'i' for iOS simulator
```

---

## Day-to-Day Development

### Running locally (no EAS needed)
```bash
npx expo start
```
This uses Metro bundler — fastest way to develop and test on an emulator.

### Building an APK for device testing
```bash
eas build --profile preview --platform android
```
This uses **your own** EAS account and quota, not the main project's.

---

## Submitting Changes

### Keep your fork in sync
Before starting new work, always sync with the upstream repo:
```bash
git fetch upstream
git merge upstream/master
```

### Open a Pull Request
1. Commit and push your changes to your fork
2. Open a PR from your fork to `0822jm/Sevaconnect-backend` or `0822jm/Sevaconnect-app`
3. Describe what you changed and why
4. Wait for review before merging

### Migration rules
- If your changes require a DB schema change, include the migration in `src/migrate.ts`
- **Only add new steps** — never modify or remove existing migration steps
- Your migration will be reviewed before being run against the main database
- Test your migration thoroughly on your own NeonDB first

---

## What NOT to do

- Never push directly to the `0822jm` repos — always use a PR
- Never commit `.env` or `.env.local` files — they are gitignored for a reason
- Never commit your `extra.eas.projectId` changes from `app.json`
- Never modify or delete existing migration steps in `migrate.ts`
