# Email Function Troubleshooting - Madison88 BMS

## Common Issues and Fixes

### 1. Environment Variables Not Set (Most Common Issue)
**Problem**: Email functions don't work because SMTP credentials are missing in live environment.

**Fix**:
- **Render/Express Backend**: Go to Render dashboard → Your backend service → Environment tab
- **Netlify Functions**: Go to Netlify dashboard → Site settings → Environment variables

**Required Variables (Set Both!)**:
```env
# Brevo (Sendinblue) SMTP
SMTP_HOST=smtp-relay.brevo.com
SMTP_PORT=587
SMTP_SECURE=false
SMTP_USER=your_brevo_smtp_user@yourdomain.com
SMTP_PASS=your_brevo_master_password
EMAIL_FROM=noreply@madison88.com

# Alternative: Gmail (use App Password)
# SMTP_HOST=smtp.gmail.com
# SMTP_PORT=587
# SMTP_SECURE=false
# SMTP_USER=your-email@gmail.com
# SMTP_PASS=your-gmail-app-password
# EMAIL_FROM=your-email@gmail.com
```

---

### 2. Brevo (Sendinblue) Configuration
**How to Get Brevo SMTP Credentials**:
1. Login to Brevo (https://app.brevo.com/)
2. Go to **SMTP & API** → **SMTP**
3. Copy your SMTP User (usually your email)
4. Click **Generate a new SMTP key**
5. Use that key as your `SMTP_PASS`

---

### 3. Gmail Configuration
**How to Use Gmail**:
1. Enable 2FA on your Google account
2. Go to https://myaccount.google.com/apppasswords
3. Create an App Password (select "Mail" and "Other (Custom Name)")
4. Use that App Password as your `SMTP_PASS`

---

### 4. Test Email Sending
**From Backend (Express)**:
Add a test endpoint or use curl:
```bash
curl -X POST https://your-backend-url.com/api/system/test-email \
  -H "Content-Type: application/json" \
  -d '{"to": "test@example.com"}'
```

**From Netlify Functions**:
Check the function logs in Netlify dashboard → Functions → requests.js (or relevant function)

---

### 5. Check Logs
- **Express Backend (Render)**: Go to Render dashboard → Your service → Logs
- **Netlify Functions**: Go to Netlify dashboard → Functions → Select function → Logs
- **Brevo**: Go to Brevo dashboard → Statistics → Email Logs

---

### Checklist for Fixing Email Issues
- [ ] All required SMTP environment variables are set
- [ ] SMTP credentials are correct (test in a tool like Thunderbird first)
- [ ] `EMAIL_FROM` is a valid email address
- [ ] Environment variables set in **both** places if using both Express and Netlify
- [ ] Check logs for specific error messages
- [ ] Verify your email provider allows SMTP access
