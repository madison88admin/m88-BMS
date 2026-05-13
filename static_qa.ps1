$ErrorActionPreference = "Continue"
$frontendSrc = "c:\Users\jcmad\Desktop\BMS\frontend\src"
$backendSrc  = "c:\Users\jcmad\Desktop\BMS\backend\src"

Write-Host "`n=== CONSOLE.LOG/ERROR SCAN (Frontend) ===" -ForegroundColor Cyan
$frontendFiles = Get-ChildItem -Path $frontendSrc -Recurse -Include "*.tsx","*.ts" | Where-Object { $_.FullName -notlike "*node_modules*" }
foreach ($f in $frontendFiles) {
    $lines = Select-String -Path $f.FullName -Pattern "console\.(log|error|warn)" | Where-Object { $_ -notmatch "\/\/" }
    if ($lines) {
        Write-Host "  WARN  $($f.Name)" -ForegroundColor Yellow
        foreach ($l in $lines) {
            Write-Host "        L$($l.LineNumber): $($l.Line.Trim())"
        }
    }
}

Write-Host "`n=== CONSOLE.LOG/ERROR SCAN (Backend - non-intentional) ===" -ForegroundColor Cyan
# In backend, only flag console.log (not console.error which is intentional for server)
$backendFiles = Get-ChildItem -Path $backendSrc -Recurse -Include "*.ts" | Where-Object { $_.FullName -notlike "*node_modules*" }
foreach ($f in $backendFiles) {
    $lines = Select-String -Path $f.FullName -Pattern "console\.log" | Where-Object { $_ -notmatch "\/\/" }
    if ($lines) {
        Write-Host "  WARN  $($f.Name)" -ForegroundColor Yellow
        foreach ($l in $lines) {
            Write-Host "        L$($l.LineNumber): $($l.Line.Trim())"
        }
    }
}

Write-Host "`n=== TODO/FIXME/HACK MARKERS ===" -ForegroundColor Cyan
$allFiles = Get-ChildItem -Path "c:\Users\jcmad\Desktop\BMS\frontend\src","c:\Users\jcmad\Desktop\BMS\backend\src" -Recurse -Include "*.tsx","*.ts" | Where-Object { $_.FullName -notlike "*node_modules*" }
foreach ($f in $allFiles) {
    $lines = Select-String -Path $f.FullName -Pattern "TODO|FIXME|HACK|XXX" | Where-Object { $_ -notmatch "\/\*\*" }
    if ($lines) {
        Write-Host "  NOTE  $($f.Name)" -ForegroundColor DarkYellow
        foreach ($l in $lines) {
            Write-Host "        L$($l.LineNumber): $($l.Line.Trim())"
        }
    }
}

Write-Host "`n=== HARDCODED SECRETS SCAN ===" -ForegroundColor Cyan
$secretPatterns = "password123|mysecret|hardcoded|api_key\s*=\s*['""]|secret\s*=\s*['""]"
foreach ($f in $allFiles) {
    $lines = Select-String -Path $f.FullName -Pattern $secretPatterns -CaseSensitive:$false | Where-Object { $_ -notmatch "\/\/" -and $_ -notmatch "test|mock|demo|example|placeholder" }
    if ($lines) {
        Write-Host "  WARN  $($f.Name)" -ForegroundColor Red
        foreach ($l in $lines) {
            Write-Host "        L$($l.LineNumber): $($l.Line.Trim())"
        }
    }
}

Write-Host "`n=== ROUTE CONSISTENCY CHECK ===" -ForegroundColor Cyan
# Check for navigate('/') — role-redirect bounce bug pattern
$navRoot = Select-String -Path (Get-ChildItem "$frontendSrc\pages" -Recurse -Include "*.tsx") -Pattern "navigate\(['\`"]/['\`"]\)" 
if ($navRoot) {
    foreach ($l in $navRoot) {
        Write-Host "  WARN  navigate('/') found - possible redirect bounce: $($l.Filename) L$($l.LineNumber)" -ForegroundColor Yellow
    }
} else {
    Write-Host "  PASS  No navigate('/') bounce patterns found" -ForegroundColor Green
}

# Check for any hardcoded localhost in frontend (non-dev)
$localhost = Select-String -Path (Get-ChildItem "$frontendSrc" -Recurse -Include "*.ts","*.tsx") -Pattern "localhost:5000|localhost:3000" | Where-Object { $_.Filename -ne "api.ts" }
if ($localhost) {
    foreach ($l in $localhost) {
        Write-Host "  WARN  Hardcoded localhost in non-api file: $($l.Filename) L$($l.LineNumber)" -ForegroundColor Yellow
    }
} else {
    Write-Host "  PASS  No rogue localhost references outside api.ts" -ForegroundColor Green
}

Write-Host "`n=== UNHANDLED PROMISE SCAN ===" -ForegroundColor Cyan
$unhandled = Select-String -Path (Get-ChildItem "$frontendSrc\pages" -Recurse -Include "*.tsx") -Pattern "\.then\(" | Where-Object { $_ -notmatch "\.catch\(" -and $_ -notmatch "\/\/" }
# Only flag if the same line has .then but no catch visible (heuristic)
$unhandledFiles = $unhandled | Group-Object Filename | Where-Object { $_.Count -gt 0 }
if ($unhandledFiles) {
    Write-Host "  INFO  Files with .then() chains (verify .catch() exists):" -ForegroundColor DarkYellow
    foreach ($g in $unhandledFiles) {
        Write-Host "        $($g.Name) ($($g.Count) chains)"
    }
} else {
    Write-Host "  PASS  No unhandled .then() patterns detected" -ForegroundColor Green
}

Write-Host "`n=== ANY EMPTY CATCH BLOCKS ===" -ForegroundColor Cyan
$emptyCatch = Select-String -Path (Get-ChildItem "$frontendSrc\pages","$backendSrc\routes" -Recurse -Include "*.tsx","*.ts") -Pattern "catch\s*\(.*\)\s*\{\s*\}" 
if ($emptyCatch) {
    foreach ($l in $emptyCatch) {
        Write-Host "  WARN  Empty catch: $($l.Filename) L$($l.LineNumber) - $($l.Line.Trim())" -ForegroundColor Yellow
    }
} else {
    Write-Host "  PASS  No empty catch blocks found" -ForegroundColor Green
}

Write-Host "`n=== Done ===" -ForegroundColor Cyan
