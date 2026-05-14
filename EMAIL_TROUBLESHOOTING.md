# Email Function Troubleshooting - Madison88 BMS (Brevo Only)

## Only Brevo is Used!
This system uses **Brevo (formerly Sendinblue)** exclusively for sending emails!

---

## Step-by-Step Brevo Setup

### 1. Get Brevo SMTP Credentials
1. Login to Brevo: https://app.brevo.com/
2. Go to **SMTP & API** → **SMTP** (left sidebar)
3. You'll see:
   - **SMTP Server**: `smtp-relay.brevo.com`
   - **Port**: `587` (STARTTLS, recommended) or `465` (SSL/TLS)
4. Under **Login**: Use your Brevo account email (e.g., `bms.admin1@gmail.com`)
5. Under **Master Password**:
   - Click **Generate a new SMTP key**
   - Name it: `Madison88 BMS Production`
   - **Copy this key!** This is your `SMTP_PASS`

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
SMTP_HOST=smtp-relay.brevo.com
SMTP_PORT=465
SMTP_SECURE=true
SMTP_USER=bms.admin1@gmail.com          (your Brevo login email)
SMTP_PASS=YOUR_BREVO_SMTP_KEY          (from Step 1, the key you generated)
EMAIL_FROM=bms.admin1@gmail.com         (same as SMTP_USER)
```

---

### 4. Test the Email System
1. Wait for Render to auto-deploy the latest changes
2. Try the "Forgot Password" flow in the app
3. Check Render logs for messages starting with `[Email]`
4. Check Brevo's **Email Logs** (Brevo → Statistics → Email Logs)

---

## Common Brevo Issues & Fixes

### Issue: "Invalid login" or "Authentication failed"
- Check that `SMTP_USER` is exactly your Brevo login email
- Make sure `SMTP_PASS` is a **Brevo SMTP key** (not your Brevo account password)
- Generate a new SMTP key in Brevo and try again

### Issue: "Relay access denied" or "Sender invalid"
- Your sender email (`EMAIL_FROM`) is **not verified** in Brevo
- Go back to Step 2 and verify your sender email

### Issue: No logs after "Sending email via transporter..."
- Wait 10-15 seconds - emails send asynchronously now!
- Check if Render restarted the service (logs show "Deploying..." or "Server running on port 5000")
- Verify Brevo account is active and has sending credits

---

## Checklist (Make sure all are done!)
- [ ] Brevo account created and logged in
- [ ] Brevo SMTP key generated and copied
- [ ] Sender email (`bms.admin1@gmail.com`) verified in Brevo
- [ ] All 6 Render environment variables set correctly
- [ ] Latest code deployed to Render
- [ ] Render logs checked for `[Email]` messages
- [ ] Brevo Email Logs checked for sent emails

