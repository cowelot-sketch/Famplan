# 🏡 FamPlan – Family Calendar & Chores

A family calendar, chore tracker, and reward system — with **real-time sync across all devices**.

---

## ✨ Features
- 📅 Family calendar with color-coded events per person
- ✅ Chore tracker with kid-friendly tap-to-check-off view
- 🏆 Reward points, badges, and customizable prize store
- ☁️ **Real-time sync** — all family devices share the same data instantly
- 📱 PWA — installs on tablet/phone like a native app
- 🔄 Offline mode — works without internet after first load
- 📅 iCal export/import — sync with Google Calendar, Apple Calendar, Outlook

---

## 🚀 Part 1 — Deploy the app (~3 minutes)

### Step 1 – Put the code on GitHub
1. Go to [github.com](https://github.com) → sign up / log in
2. Click **+** → **New repository** → name it `famplan` → click **Create**
3. On the next screen click **uploading an existing file**
4. Drag the entire contents of this folder into the upload area
5. Click **Commit changes**

### Step 2 – Deploy on Vercel (free, recommended)
1. Go to [vercel.com](https://vercel.com) → sign up with your GitHub account
2. Click **Add New → Project** → select your `famplan` repository
3. Leave all settings as default — click **Deploy**
4. In ~2 minutes you'll have a live URL like `https://famplan.vercel.app`

> **Alternative:** Drag-and-drop the folder to [netlify.com](https://netlify.com) for instant deploy.

### Step 3 – Add to your tablet / phone home screen

**iPad / iPhone (Safari):**
Tap the **Share** button → **Add to Home Screen** → **Add**

**Android (Chrome):**
Tap the **three-dot menu** → **Add to Home Screen** → **Install**

The app opens full-screen with no browser chrome, just like a native app ✅

---

## ☁️ Part 2 — Add real-time sync (~5 minutes)

This makes all family devices share the same calendar, chores, and points live.

### Step 1 – Create a free Supabase project
1. Go to [supabase.com](https://supabase.com) → **Start for free**
2. Click **New project** → name it `famplan` → set a database password → **Create**
3. Wait about 1 minute while it provisions

### Step 2 – Set up the database
1. In your Supabase dashboard, click **SQL Editor** in the left sidebar
2. Click **New query**
3. Open `supabase-setup.sql` (included in this folder) and **paste the entire contents**
4. Click **Run** — you should see "Success. No rows returned"

### Step 3 – Copy your API keys
1. In Supabase, go to **Settings** (gear icon) → **API**
2. Note these two values:
   - **Project URL** — looks like `https://abcxyz.supabase.co`
   - **anon / public key** — long string starting with `eyJ...`

### Step 4 – Add keys to Vercel
1. Open your Vercel project → click **Settings** → **Environment Variables**
2. Add all three of these:

| Variable name | Value |
|---|---|
| `REACT_APP_SUPABASE_URL` | Your Project URL from Step 3 |
| `REACT_APP_SUPABASE_ANON_KEY` | Your anon key from Step 3 |
| `REACT_APP_FAMILY_ID` | A unique string like `smith-family-2026` |

3. Click **Save**
4. Go to **Deployments** → click the three-dot menu on the latest → **Redeploy**

### Step 5 — Done! 🎉
Open the app on any device. You'll see **☁️ Synced** in the header.
Changes on one device appear on all others within a second or two.

---

## 💻 Running locally

```bash
# Requires Node.js (download from nodejs.org)

cd famplan
npm install

# Set up your local environment
cp .env.example .env.local
# Open .env.local and paste your Supabase keys + family ID

npm start
# App opens at http://localhost:3000
```

---

## 📐 Responsive layouts

| Device | Layout |
|--------|--------|
| Phone (portrait) | Single column + fixed bottom tab bar |
| Tablet (portrait) | Wider grid, top navigation bar |
| Tablet (landscape, 1024px+) | Persistent sidebar + main content area |

---

## 🗂️ File structure

```
famplan/
├── public/
│   ├── index.html          ← PWA meta tags, safe-area insets, iOS fullscreen
│   ├── manifest.json       ← Home screen name, icon, theme color
│   └── sw.js               ← Service worker for offline mode
├── src/
│   ├── App.js              ← Main app (all UI + local state)
│   ├── sync.js             ← Supabase cloud sync + real-time subscriptions
│   ├── tablet.css          ← Responsive CSS (phone / tablet / landscape)
│   └── index.js            ← React entry point
├── supabase-setup.sql      ← Run once in Supabase SQL Editor
├── .env.example            ← Copy to .env.local, fill in your keys
├── vercel.json             ← Vercel deployment config
├── netlify.toml            ← Netlify deployment config (alternative)
├── package.json
└── README.md               ← You are here
```

---

## 🔒 Security notes

- The **anon key** is safe to include in your frontend — Row Level Security in Supabase controls access
- The **FAMILY_ID** acts as a simple shared secret — keep it unique and don't share publicly
- For stronger security (login with email/password), Supabase Auth can be added — ask Claude!

---

## 🔄 Updating the app after deploy

Edit any file → push to GitHub → Vercel auto-deploys in ~1 minute → all devices update automatically.
