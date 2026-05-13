$ErrorActionPreference = "Continue"
$base = "https://m88-bms.onrender.com"
$pass = 0; $fail = 0; $warns = @()

function Check {
    param($label, $ok, $detail = '')
    if ($ok) {
        Write-Host "  PASS  $label" -ForegroundColor Green
        $script:pass++
    } else {
        Write-Host "  FAIL  $label $detail" -ForegroundColor Red
        $script:fail++
    }
}

function GET {
    param($url, $headers)
    try {
        $r = Invoke-WebRequest -Uri $url -Headers $headers -TimeoutSec 20 -UseBasicParsing
        return @{ ok=$true; code=$r.StatusCode; body=($r.Content | ConvertFrom-Json -ErrorAction SilentlyContinue) }
    } catch {
        $code = $_.Exception.Response.StatusCode.value__
        return @{ ok=$false; code=$code; err=$_.Exception.Message }
    }
}

function POST {
    param($url, $body, $headers)
    try {
        $r = Invoke-WebRequest -Uri $url -Method POST -Body ($body | ConvertTo-Json) -ContentType "application/json" -Headers $headers -TimeoutSec 20 -UseBasicParsing
        return @{ ok=$true; code=$r.StatusCode; body=($r.Content | ConvertFrom-Json -ErrorAction SilentlyContinue) }
    } catch {
        $code = $_.Exception.Response.StatusCode.value__
        return @{ ok=$false; code=$code; err=$_.Exception.Message }
    }
}

function PATCH {
    param($url, $body, $headers)
    try {
        $r = Invoke-WebRequest -Uri $url -Method PATCH -Body ($body | ConvertTo-Json) -ContentType "application/json" -Headers $headers -TimeoutSec 20 -UseBasicParsing
        return @{ ok=$true; code=$r.StatusCode; body=($r.Content | ConvertFrom-Json -ErrorAction SilentlyContinue) }
    } catch {
        $code = $_.Exception.Response.StatusCode.value__
        return @{ ok=$false; code=$code; err=$_.Exception.Message }
    }
}

# ============================================================
Write-Host "`n=== BACKEND CONNECTIVITY ===" -ForegroundColor Cyan
$health = GET "$base/api/system/health" @{}
Check "GET /api/system/health => 200" ($health.code -eq 200)
Check "Health body has status=healthy" ($health.body.status -eq 'healthy')

# ============================================================
Write-Host "`n=== AUTH: LOGIN ===" -ForegroundColor Cyan

$empLogin  = POST "$base/api/auth/login" @{email="john.employee@madison88.com"; password="password123"} @{}
Check "Employee login => 200" ($empLogin.code -eq 200)
Check "Employee token present" ($null -ne $empLogin.body.token)
$empTok = $empLogin.body.token
$empH = @{ Authorization = "Bearer $empTok" }

$supLogin  = POST "$base/api/auth/login" @{email="jane.supervisor@madison88.com"; password="password123"} @{}
Check "Supervisor login => 200" ($supLogin.code -eq 200)
$supTok = $supLogin.body.token
$supH = @{ Authorization = "Bearer $supTok" }

$accLogin  = POST "$base/api/auth/login" @{email="bob.accounting@madison88.com"; password="password123"} @{}
Check "Accounting login => 200" ($accLogin.code -eq 200)
$accTok = $accLogin.body.token
$accH = @{ Authorization = "Bearer $accTok" }

$badLogin  = POST "$base/api/auth/login" @{email="john.employee@madison88.com"; password="wrongpass"} @{}
Check "Bad password => 400" ($badLogin.code -eq 400)

$noLogin   = POST "$base/api/auth/login" @{email="nobody@nowhere.com"; password="whatever"} @{}
Check "Unknown user => 400" ($noLogin.code -eq 400)

# ============================================================
Write-Host "`n=== AUTH: /ME ===" -ForegroundColor Cyan
$me = GET "$base/api/auth/me" $empH
Check "GET /api/auth/me => 200" ($me.code -eq 200)
Check "Role is employee" ($me.body.role -eq 'employee')
Check "department_id present" ($null -ne $me.body.department_id)
$deptId = $me.body.department_id
$empId  = $me.body.id
$fy     = $me.body.fiscal_year

$meNoTok = GET "$base/api/auth/me" @{}
Check "GET /api/auth/me no token => 401" ($meNoTok.code -eq 401)

# ============================================================
Write-Host "`n=== REQUESTS ===" -ForegroundColor Cyan
$reqs = GET "$base/api/requests" $empH
Check "GET /api/requests (employee) => 200" ($reqs.code -eq 200)
Check "Returns array" ($reqs.body -is [array])

$supReqs = GET "$base/api/requests" $supH
Check "GET /api/requests (supervisor) => 200" ($supReqs.code -eq 200)

$accReqs = GET "$base/api/requests" $accH
Check "GET /api/requests (accounting) => 200" ($accReqs.code -eq 200)

$myReqs = GET "$base/api/requests/my" $empH
Check "GET /api/requests/my => 200" ($myReqs.code -eq 200)

$noTokReqs = GET "$base/api/requests" @{}
Check "GET /api/requests no token => 401" ($noTokReqs.code -eq 401)

$offList = GET "$base/api/requests/official-list" $empH
Check "GET /api/requests/official-list => 200" ($offList.code -eq 200)
Check "Official list has items" ($offList.body.Count -gt 0)

# ============================================================
Write-Host "`n=== BUDGET ===" -ForegroundColor Cyan
$cats = GET "$base/api/budget/categories?department_id=$deptId&fiscal_year=$fy" $empH
Check "GET /api/budget/categories => 200" ($cats.code -eq 200)
Check "Returns array" ($cats.body -is [array])

$catsFY = GET "$base/api/budget/categories?all_years=true" $accH
Check "GET /api/budget/categories all_years (accounting) => 200" ($catsFY.code -eq 200)

$catsForbid = POST "$base/api/budget/categories" @{test=1} $empH
Check "POST /api/budget/categories (employee) => 403" ($catsForbid.code -eq 403)

$cc = GET "$base/api/budget/cost-centers?department_id=$deptId" $empH
Check "GET /api/budget/cost-centers => 200" ($cc.code -eq 200)

# ============================================================
Write-Host "`n=== DEPARTMENTS ===" -ForegroundColor Cyan
$depts = GET "$base/api/departments" $empH
Check "GET /api/departments => 200" ($depts.code -eq 200)
Check "Has departments" ($depts.body.Count -gt 0)

# ============================================================
Write-Host "`n=== NOTIFICATIONS ===" -ForegroundColor Cyan
$notifs = GET "$base/api/notifications" $empH
Check "GET /api/notifications => 200" ($notifs.code -eq 200)

# ============================================================
Write-Host "`n=== CONFIG ===" -ForegroundColor Cyan
$thresh = GET "$base/api/config/auth-thresholds" $accH
Check "GET /api/config/auth-thresholds (accounting) => 200" ($thresh.code -eq 200)
Check "Thresholds body has PHP key" ($null -ne $thresh.body.thresholds.PHP)

$threshEmp = GET "$base/api/config/auth-thresholds" $empH
Check "GET /api/config/auth-thresholds (employee) => 200 or 403" ($threshEmp.code -eq 200 -or $threshEmp.code -eq 403)

# ============================================================
Write-Host "`n=== CASH ADVANCES ===" -ForegroundColor Cyan
$ca = GET "$base/api/cash-advances/for-liquidation/$empId" $empH
Check "GET /api/cash-advances/for-liquidation/:id => 200" ($ca.code -eq 200)

$caAll = GET "$base/api/cash-advances" $accH
Check "GET /api/cash-advances (accounting) => 200" ($caAll.code -eq 200)

$caNoTok = GET "$base/api/cash-advances" @{}
Check "GET /api/cash-advances no token => 401" ($caNoTok.code -eq 401)

# ============================================================
Write-Host "`n=== AUDIT LOGS ===" -ForegroundColor Cyan
$audit = GET "$base/api/requests/audit-logs" $accH
Check "GET /api/requests/audit-logs (accounting) => 200" ($audit.code -eq 200)

$auditEmp = GET "$base/api/requests/audit-logs" $empH
Check "GET /api/requests/audit-logs (employee) => 403" ($auditEmp.code -eq 403)

# ============================================================
Write-Host "`n=== REPORTS ===" -ForegroundColor Cyan
$reports = GET "$base/api/reports" $accH
Check "GET /api/reports (accounting) => 200 or 404" ($reports.code -eq 200 -or $reports.code -eq 404)

# ============================================================
Write-Host "`n=== FRONTEND ROUTES (Netlify SPA) ===" -ForegroundColor Cyan
$routes = @("/", "/login", "/tracker", "/approvals", "/requests/new", "/admin",
            "/accounting", "/budget-setup", "/budget-management", "/employee",
            "/finance", "/cash-advance-aging", "/profile", "/management")
foreach ($route in $routes) {
    try {
        $r = Invoke-WebRequest -Uri "https://m88-bms.netlify.app$route" -TimeoutSec 15 -UseBasicParsing
        Check "Netlify$route => 200" ($r.StatusCode -eq 200)
    } catch {
        Check "Netlify$route => 200" $false "[$($_.Exception.Message)]"
    }
}

# ============================================================
Write-Host "`n=== SECURITY GUARDS ===" -ForegroundColor Cyan

# Employee cannot approve
$fakeApprove = PATCH "$base/api/requests/00000000-0000-0000-0000-000000000001/approve" @{} $empH
Check "PATCH /approve (employee) => 403" ($fakeApprove.code -eq 403)

# Employee cannot reject
$fakeReject = PATCH "$base/api/requests/00000000-0000-0000-0000-000000000001/reject" @{reason="test"} $empH
Check "PATCH /reject (employee) => 403" ($fakeReject.code -eq 403)

# Employee cannot release
$fakeRelease = PATCH "$base/api/requests/00000000-0000-0000-0000-000000000001/release" @{} $empH
Check "PATCH /release (employee) => 403" ($fakeRelease.code -eq 403)

# Employee cannot archive
$fakeArchive = PATCH "$base/api/requests/00000000-0000-0000-0000-000000000001/archive" @{archived=$true} $empH
Check "PATCH /archive (employee) => 403" ($fakeArchive.code -eq 403)

# Nonexistent request => 404
$notFound = GET "$base/api/requests/00000000-0000-0000-0000-000000000001" $accH
Check "GET nonexistent request (accounting) => 400 or 404" ($notFound.code -eq 400 -or $notFound.code -eq 404)

# ============================================================
Write-Host "`n=============================" -ForegroundColor Cyan
Write-Host "  TOTAL PASS : $pass" -ForegroundColor Green
Write-Host "  TOTAL FAIL : $fail" -ForegroundColor $(if ($fail -eq 0) { 'Green' } else { 'Red' })
Write-Host "=============================" -ForegroundColor Cyan
