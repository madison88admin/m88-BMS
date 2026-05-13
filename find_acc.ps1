$ErrorActionPreference = "Continue"
$base = "https://m88-bms.onrender.com"

# First use the supervisor token to get all users and find accounting emails
$supLogin = Invoke-WebRequest -Uri "$base/api/auth/login" -Method POST `
    -Body '{"email":"jane.supervisor@madison88.com","password":"password123"}' `
    -ContentType "application/json" -UseBasicParsing
$supData = $supLogin.Content | ConvertFrom-Json
$supTok = $supData.token
$supH = @{ Authorization = "Bearer $supTok" }

# Try users endpoint
try {
    $users = Invoke-WebRequest -Uri "$base/api/users" -Headers $supH -UseBasicParsing
    $usersData = $users.Content | ConvertFrom-Json
    $accUsers = $usersData | Where-Object { $_.role -eq 'accounting' }
    Write-Host "Accounting users:"
    $accUsers | Select-Object email, name, role | Format-Table
} catch {
    Write-Host "No /api/users endpoint, trying alternate..."
}

# Also try with admin login via different known credentials
$candidates = @(
    "alice.accounting@madison88.com",
    "bob.accounting@madison88.com",
    "accounting.staff@madison88.com",
    "acct@madison88.com",
    "finance@madison88.com",
    "treasurer@madison88.com"
)

foreach ($email in $candidates) {
    try {
        $r = Invoke-WebRequest -Uri "$base/api/auth/login" -Method POST `
            -Body "{`"email`":`"$email`",`"password`":`"password123`"}" `
            -ContentType "application/json" -UseBasicParsing -ErrorAction Stop
        $d = $r.Content | ConvertFrom-Json
        Write-Host "FOUND: $email => role=$($d.user.role)"
    } catch {
        $code = $_.Exception.Response.StatusCode.value__
        Write-Host "MISS: $email => $code"
    }
}
