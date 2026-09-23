$ErrorActionPreference = "Stop"
$Root = $PSScriptRoot
$Project = Join-Path $Root "SenhaHub.PrintAgent.Diagnostic.csproj"
$Output = Join-Path $Root "bin\Release\SenhaHub.PrintAgent.Diagnostic.exe"
$ArtifactDir = Join-Path $Root "artifacts"
$Artifact = Join-Path $ArtifactDir "SenhaHub.PrintAgent.Diagnostic.exe"
$VersionedArtifact = Join-Path $ArtifactDir "SenhaHub.PrintAgent.Diagnostic-v1.0.3.exe"

$MsBuild = Get-Command msbuild.exe -ErrorAction SilentlyContinue
if (-not $MsBuild) {
  $VsWhere = Join-Path ${env:ProgramFiles(x86)} "Microsoft Visual Studio\Installer\vswhere.exe"
  if (Test-Path $VsWhere) {
    $MsBuildPath = & $VsWhere -latest -products * -requires Microsoft.Component.MSBuild -find MSBuild\**\Bin\MSBuild.exe | Select-Object -First 1
    if ($MsBuildPath) { $MsBuild = @{ Path = $MsBuildPath } }
  }
}
if (-not $MsBuild) { throw "MSBuild não encontrado. Compile em Windows com Visual Studio ou Build Tools e .NET Framework 4.8." }
& $MsBuild.Path $Project /t:Build /p:Configuration=Release /p:Platform=AnyCPU /v:minimal
if ($LASTEXITCODE -ne 0) { throw "Falha ao compilar o diagnóstico." }
if (-not (Test-Path $Output)) { throw "Executável não encontrado: $Output" }
New-Item -ItemType Directory -Force -Path $ArtifactDir | Out-Null
Copy-Item $Output $Artifact -Force
Copy-Item $Output $VersionedArtifact -Force
Write-Host "Diagnóstico criado em: $Artifact"
