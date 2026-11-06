# Publishes release/leonssh.exe + the versioned NSIS installer as a GitHub Release.
#
# Requires the GitHub CLI (https://cli.github.com/) and an authenticated session
# (`gh auth login`). Without gh the script prints the manual steps instead.
#
#   pwsh scripts/publish-release.ps1
#   pwsh scripts/publish-release.ps1 -Notes "修复光标动画"

param(
  [string]$Notes = "See README for the feature list."
)

$ErrorActionPreference = "Stop"
$root = Split-Path -Parent (Split-Path -Parent $MyInvocation.MyCommand.Path)
Push-Location $root
try {
  $pkg = Get-Content package.json -Raw | ConvertFrom-Json
  $version = $pkg.version
  $tag = "v$version"

  $exe = Join-Path $root "release/leonssh.exe"
  $setup = Join-Path $root "release/LeonSSH_${version}_x64-setup.exe"
  foreach ($file in @($exe, $setup)) {
    if (-not (Test-Path $file)) {
      throw "缺少 $file，请先运行 pnpm build:release"
    }
  }

  $gh = Get-Command gh -ErrorAction SilentlyContinue
  if ($null -eq $gh) {
    Write-Host "未找到 GitHub CLI。可以手动发布：" -ForegroundColor Yellow
    Write-Host "  1. 打开 https://github.com/ly-0418/LeonSSH/releases/new?tag=$tag"
    Write-Host "  2. 标题填 LeonSSH $version，正文填更新说明"
    Write-Host "  3. 上传："
    Write-Host "     $exe"
    Write-Host "     $setup"
    Write-Host "  4. 点击 Publish release"
    return
  }

  & gh release create $tag $exe $setup --title "LeonSSH $version" --notes $Notes
  Write-Host "已创建 Release $tag" -ForegroundColor Green
  Write-Host "https://github.com/ly-0418/LeonSSH/releases/latest"
}
finally {
  Pop-Location
}
