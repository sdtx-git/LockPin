param(
  [Parameter(Position = 0)]
  [ValidateSet('build', 'up', 'sync', 'test', 'run', 'shell', 'down', 'android-init', 'apk', 'portable')]
  [string]$Command = 'test'
)

$ErrorActionPreference = 'Stop'
$Image = 'lockpin-dev'
$Container = 'lockpin-dev'
$Root = Split-Path -Parent $PSScriptRoot
$Tar = Join-Path $env:TEMP 'lockpin-src.tar'
$WslgHost = '/run/desktop/mnt/host/wslg'

function Invoke-Docker {
  & docker @args
  if ($LASTEXITCODE -ne 0) { throw "docker $($args -join ' ') falhou (exit $LASTEXITCODE)" }
}

function Test-Running {
  [bool](docker ps -q --filter "name=^${Container}$")
}

function Start-Dev {
  if (docker ps -aq --filter "name=^${Container}$") {
    $current = docker inspect $Container --format '{{.Image}}'
    $latest = docker image inspect $Image --format '{{.Id}}'
    if ($current -eq $latest) {
      if (-not (Test-Running)) { Invoke-Docker start $Container | Out-Null }
      return
    }
    Invoke-Docker rm -f $Container | Out-Null
  }
  Invoke-Docker run -d --name $Container `
    -v lockpin-node-modules:/app/node_modules `
    -v lockpin-cargo-target:/app/src-tauri/target `
    -v lockpin-cargo-registry:/usr/local/cargo/registry `
    -v lockpin-npm-cache:/root/.npm `
    -v lockpin-gradle:/root/.gradle `
    -v lockpin-data:/root/.local/share/lockpin `
    -v "${WslgHost}/.X11-unix:/tmp/.X11-unix" `
    -v "${WslgHost}:/mnt/wslg" `
    -e DISPLAY=:0 `
    -e XDG_RUNTIME_DIR=/mnt/wslg/runtime-dir `
    $Image | Out-Null
}

function Sync-Source([string]$Target = $Container) {
  if ($Target -eq $Container) { Start-Dev }
  & "$env:SystemRoot\System32\tar.exe" -cf $Tar -C $Root --exclude node_modules --exclude dist --exclude .git --exclude ./src-tauri/target --exclude ./build-android --exclude ./build-portable --exclude ./src-tauri/gen/android/app/build --exclude ./src-tauri/gen/android/build --exclude ./src-tauri/gen/android/.gradle .
  if ($LASTEXITCODE -ne 0) { throw "tar falhou (exit $LASTEXITCODE)" }
  Invoke-Docker cp $Tar "${Target}:/tmp/src.tar"
  Remove-Item $Tar
  Invoke-Docker exec $Target sh -c 'rm -rf /tmp/src && mkdir /tmp/src && tar -xf /tmp/src.tar -C /tmp/src && rsync -a --delete --exclude /node_modules --exclude /src-tauri/target --exclude /src-tauri/gen/android/app/build --exclude /src-tauri/gen/android/build --exclude /src-tauri/gen/android/.gradle /tmp/src/ /app/'
  Invoke-Docker exec $Target sh -c 'sha256sum package-lock.json > /tmp/lock-hash; cmp -s /tmp/lock-hash node_modules/.lock-hash || { npm ci && cp /tmp/lock-hash node_modules/.lock-hash; }'
}

function Start-Portable {
  $image = 'lockpin-portable'
  if (-not (docker image ls -q $image)) {
    Invoke-Docker build -t $image -f (Join-Path $Root 'docker/Dockerfile.portable') (Join-Path $Root 'docker') | Out-Host
  }
  if (docker ps -aq --filter "name=^${image}$") {
    if (-not (docker ps -q --filter "name=^${image}$")) { Invoke-Docker start $image | Out-Null }
  } else {
    Invoke-Docker run -d --name $image `
      -v lockpin-portable-node-modules:/app/node_modules `
      -v lockpin-portable-target:/app/src-tauri/target `
      -v lockpin-portable-registry:/usr/local/cargo/registry `
      -v lockpin-portable-cache:/root/.cache `
      $image | Out-Null
  }
  return $image
}

switch ($Command) {
  'build' { Invoke-Docker build -t $Image -f (Join-Path $Root 'docker/Dockerfile.dev') (Join-Path $Root 'docker') }
  'up'    { Start-Dev }
  'sync'  { Sync-Source }
  'test' {
    Sync-Source
    $steps = [ordered]@{
      'typecheck'   = 'npm run typecheck'
      'vitest'      = 'npx vitest run --passWithNoTests'
      'cargo check' = 'cd src-tauri && cargo check'
      'cargo test'  = 'cd src-tauri && cargo test'
    }
    $failed = @()
    foreach ($name in $steps.Keys) {
      Write-Host "==> $name" -ForegroundColor Cyan
      & docker exec $Container sh -c $steps[$name]
      if ($LASTEXITCODE -ne 0) { $failed += $name }
    }
    if ($failed) { Write-Host "FALHOU: $($failed -join ', ')" -ForegroundColor Red; exit 1 }
    Write-Host 'OK: todos os passos passaram' -ForegroundColor Green
  }
  'run' {
    Sync-Source
    & docker exec -it $Container npm run tauri:dev
  }
  'shell' { Start-Dev; & docker exec -it $Container bash }
  'down'  { Invoke-Docker rm -f $Container | Out-Null }
  'android-init' {
    Sync-Source
    Invoke-Docker exec $Container npx tauri android init --ci
    $gen = Join-Path $Root 'src-tauri/gen'
    New-Item -ItemType Directory -Force $gen | Out-Null
    Invoke-Docker cp "${Container}:/app/src-tauri/gen/android" $gen
    Write-Host "Projeto Android copiado para $gen\android" -ForegroundColor Green
  }
  'apk' {
    Sync-Source
    Invoke-Docker exec $Container npx tauri android build --debug --apk --target aarch64
    $out = Join-Path $Root 'build-android'
    if (Test-Path $out) { Remove-Item -Recurse -Force $out }
    Invoke-Docker cp "${Container}:/app/src-tauri/gen/android/app/build/outputs/apk" $out
    Get-ChildItem $out -Recurse -Filter *.apk | ForEach-Object { Write-Host "APK: $($_.FullName)" -ForegroundColor Green }
  }
  'portable' {
    $ctr = Start-Portable
    Sync-Source $ctr
    Write-Host '==> Linux (AppImage)' -ForegroundColor Cyan
    Invoke-Docker exec $ctr npx tauri build --bundles appimage
    Write-Host '==> Windows (exe)' -ForegroundColor Cyan
    Invoke-Docker exec $ctr npx tauri build --runner cargo-xwin --target x86_64-pc-windows-msvc --no-bundle
    $out = Join-Path $Root 'build-portable/LockPin'
    New-Item -ItemType Directory -Force $out | Out-Null
    Invoke-Docker exec $ctr sh -c 'cp src-tauri/target/release/bundle/appimage/*.AppImage /tmp/LockPin.AppImage'
    Invoke-Docker cp "${ctr}:/tmp/LockPin.AppImage" (Join-Path $out 'LockPin.AppImage')
    Invoke-Docker cp "${ctr}:/app/src-tauri/target/x86_64-pc-windows-msvc/release/lockpin.exe" (Join-Path $out 'LockPin.exe')
    Copy-Item (Join-Path $Root 'docker/LockPin.sh') (Join-Path $out 'LockPin.sh') -Force
    Write-Host "Pasta portátil: $out" -ForegroundColor Green
  }
}
