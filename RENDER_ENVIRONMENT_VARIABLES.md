# Render Environment Variables for BMS Backend

## Required Environment Variables

### Database Configuration
```
SUPABASE_URL=your_supabase_project_url
SUPABASE_ANON_KEY=your_supabase_anon_key  
SUPABASE_SERVICE_ROLE_KEY=your_supabase_service_role_key
```

### Security
```
JWT_SECRET=your_jwt_secret_key_at_least_32_characters_long
```

### Email Configuration
```
EMAIL_HOST=smtp.gmail.com
EMAIL_PORT=587
EMAIL_USER=your_email@gmail.com
EMAIL_PASS=your_app_password
```

### Application Settings
```
NODE_ENV=production
PORT=5000
APP_URL=https://your-frontend-domain.netlify.app
```

### File Upload Settings
```
MAX_FILE_SIZE=10485760
UPLOAD_PATH=./uploads
```

### Rate Limiting
```
RATE_LIMIT_WINDOW_MS=900000
RATE_LIMIT_MAX_REQUESTS=100
```

### Password Reset
```
PASSWORD_RESET_TOKEN_TTL_MINUTES=15
```

### Company Settings
```
COMPANY_EMAIL_DOMAIN=madison88.com
```

## Setup Instructions

1. Go to your Render service dashboard
2. Click "Environment" tab
3. Add each variable above
4. Click "Save Changes"
5. Trigger a new deployment
