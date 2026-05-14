# Email Function Troubleshooting - Madison88 BMS (Brevo API Only)

## Only Brevo API is Used!
This system uses **Brevo's REST API** exclusively for sending emails! No more SMTP connection issues!

---

## Step-by-Step Brevo API Setup

### 1. Get Brevo API Key
1. Login to Brevo: https://app.brevo.com/
2. Go to **SMTP & API** → **API Keys** (left sidebar)
3. Click **Generate a new API key**
4. Name it: `Madison88 BMS Production`
5. **Copy this key!** This is your `BREVO_API_KEY` (or use `SMTP_PASS` - both work!)

---

### 2. Verify Sender Email in Brevo (CRITICAL!)
Emails will NOT send if your sender email isn't verified!
1. In Brevo, go to **Senders** → **Create a new sender**
2. Fill in:
   - **From Name**: `Madison88 BMS`
   - **From Email**: `bms.admin1@gmail.com` (or your Brevo email)
3. Click **Save**
4. Brevo will send a verification email to `bms.admin1@gmail.com`
5. Open that email and click **Verify this email address**
6. Wait 1-5 minutes for Brevo to approve it

---

### 3. Set Render Environment Variables
Go to Render → Your backend service → **Environment** tab → **Add Environment Variables**:
```env
BREVO_API_KEY=your_brevo_api_key  (from Step 1, the key you generated)
EMAIL_FROM=bms.admin1@gmail.com    (your verified Brevo sender email)
```

Note: You can also use `SMTP_PASS` instead of `BREVO_API_KEY` if you want!

---

### 4. Test the Email System
1. Wait for Render to auto-deploy the latest changes
2. Try the "Forgot Password" flow in the app
3. Check Render logs for `[Email]` messages
4. Check Brevo's **Email Logs** (Brevo → Statistics → Email Logs)

---

## Common Brevo API Issues & Fixes

### Issue: "Unauthorized" or "Invalid API key"
- Check that `BREVO_API_KEY` or `SMTP_PASS` is set correctly
- Make sure you're using a **Brevo API key** (not your Brevo account password)
- Generate a new API key in Brevo and try again

### Issue: "Sender invalid" or "Relay access denied"
- Your sender email (`EMAIL_FROM`) is **not verified** in Brevo
- Go back to Step 2 and verify your sender email

### Issue: No logs after "Sending email via Brevo API..."
- Wait 5-10 seconds - API calls are asynchronous
- Verify Brevo account is active and has sending credits
- Check Render logs for error messages

---

## Checklist (Make sure all are done!)
- [ ] Brevo account created and logged in
- [ ] Brevo API key generated and copied
- [ ] Sender email (`bms.admin1@gmail.com`) verified in Brevo
- [ ] Render environment variables set correctly (`BREVO_API_KEY` and `EMAIL_FROM`)
- [ ] Latest code deployed to Render
- [ ] Render logs checked for `[Email]` messages
- [ ] Brevo Email Logs checked for sent emails
