# 生产构建脚本 - 本地执行，产物提交到 git，服务器直接运行无需构建
$ErrorActionPreference = "Stop"
$root = Split-Path -Parent $PSCommandPath
Set-Location $root
Write-Host "=== Vendure 生产构建 ===" -ForegroundColor Cyan
$corePkgs = @("common","core","admin-ui-plugin","asset-server-plugin","email-plugin")
foreach ($pkg in $corePkgs) {
    Write-Host "`n--- 构建 $pkg ---" -ForegroundColor Yellow
    Push-Location "packages/$pkg"
    npm run build
    if ($LASTEXITCODE -ne 0) { Pop-Location; throw "$pkg build failed" }
    Pop-Location
}
$bizPkgs = @("cjk-plugin","onebridge-plugin","alipay-plugin","wechatpay-plugin","oss-plugin","phone-auth-plugin","wechat-auth-plugin","douyin-auth-plugin","order-timeout-plugin","invoice-plugin","logistics-plugin","group-buy-plugin","flash-sale-plugin","distribution-plugin","redis-stock-plugin","logistics-api-plugin","invoice-pdf-plugin","recharge-card-plugin","after-sales-plugin","member-level-plugin","review-plugin","wechat-subscribe-message-plugin","coupon-plugin","product-survey-plugin","favorite-plugin","campus-delivery-plugin")
foreach ($pkg in $bizPkgs) {
    Write-Host "`n--- 构建 $pkg ---" -ForegroundColor Yellow
    Push-Location "packages/$pkg"
    npm run build
    if ($LASTEXITCODE -ne 0) { Pop-Location; throw "$pkg build failed" }
    Pop-Location
}
Write-Host "`n--- 构建 dev-server (tsc) ---" -ForegroundColor Yellow
Push-Location "packages/dev-server"
npx --package=typescript tsc -p tsconfig.prod.json
if ($LASTEXITCODE -ne 0) { Pop-Location; throw "dev-server tsc failed" }
Write-Host "`n--- 构建 dev-server (vite dashboard) ---" -ForegroundColor Yellow
# 指定 auto：dashboard 运行时用 window.location 推导 admin-api 地址（同源走反代），
# 否则默认 http://localhost 导致生产端 admin-api 连接失败
$env:VITE_ADMIN_API_HOST = "auto"
$env:VITE_ADMIN_API_PORT = "auto"
$env:IS_PROD = "true"
npx vite build
if ($LASTEXITCODE -ne 0) { Pop-Location; throw "dev-server vite build failed" }
Pop-Location
Write-Host "`n=== 构建完成 ===" -ForegroundColor Green