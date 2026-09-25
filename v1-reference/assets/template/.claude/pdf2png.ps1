# Render PDF pages to PNG using the Windows.Data.Pdf WinRT API (built into Win10/11).
# Usage: pdf2png.ps1 -Pdf <path> -Out <dir> -Pages 5,9,13,16 -Scale 2
param(
  [Parameter(Mandatory=$true)][string]$Pdf,
  [Parameter(Mandatory=$true)][string]$Out,
  [int[]]$Pages,
  [double]$Scale = 2.0
)

Add-Type -AssemblyName System.Runtime.WindowsRuntime

$asTaskGeneric = ([System.WindowsRuntimeSystemExtensions].GetMethods() | Where-Object {
  $_.Name -eq 'AsTask' -and $_.GetParameters().Count -eq 1 -and
  $_.GetParameters()[0].ParameterType.Name -eq 'IAsyncOperation`1' })[0]

function Await($op, $type) {
  $t = $asTaskGeneric.MakeGenericMethod($type).Invoke($null, @($op))
  $t.Wait(-1) | Out-Null
  $t.Result
}
function AwaitAct($act) {
  $m = ([System.WindowsRuntimeSystemExtensions].GetMethods() | Where-Object {
    $_.Name -eq 'AsTask' -and $_.GetParameters().Count -eq 1 -and -not $_.IsGenericMethod })[0]
  $t = $m.Invoke($null, @($act)); $t.Wait(-1) | Out-Null
}

[Windows.Data.Pdf.PdfDocument, Windows.Data.Pdf, ContentType=WindowsRuntime]  | Out-Null
[Windows.Storage.StorageFile, Windows.Storage, ContentType=WindowsRuntime]    | Out-Null
[Windows.Storage.FileIO, Windows.Storage, ContentType=WindowsRuntime]         | Out-Null

if (-not (Test-Path $Out)) { New-Item -ItemType Directory -Path $Out -Force | Out-Null }

$sf  = Await ([Windows.Storage.StorageFile]::GetFileFromPathAsync((Resolve-Path $Pdf).Path)) ([Windows.Storage.StorageFile])
$doc = Await ([Windows.Data.Pdf.PdfDocument]::LoadFromFileAsync($sf)) ([Windows.Data.Pdf.PdfDocument])

Write-Output "PAGECOUNT=$($doc.PageCount)"
if (-not $Pages -or $Pages.Count -eq 0) { $Pages = 1..$doc.PageCount }

foreach ($p in $Pages) {
  if ($p -lt 1 -or $p -gt $doc.PageCount) { Write-Output "SKIP page $p (out of range)"; continue }
  $page = $doc.GetPage($p - 1)
  # WinRT GetFileFromPathAsync REQUIRES an absolute path. Handed a relative one
  # it returns null, OpenAsync then throws, and the loop still fell through to
  # "WROTE": 37 zero-byte PNGs once reported themselves as a successful render.
  # NOTE: keep this whole file ASCII. PowerShell 5.1 reads .ps1 as ANSI, so a
  # stray em-dash mangles into three bytes and breaks string parsing.
  $dest = Join-Path ((Resolve-Path $Out).Path) ("page-{0:d2}.png" -f $p)
  if (Test-Path $dest) { Remove-Item $dest -Force }
  New-Item -ItemType File -Path $dest | Out-Null
  $destSf = Await ([Windows.Storage.StorageFile]::GetFileFromPathAsync($dest)) ([Windows.Storage.StorageFile])
  if (-not $destSf) { Write-Output "FAILED page $p - could not open $dest"; continue }
  $stream = Await ($destSf.OpenAsync([Windows.Storage.FileAccessMode]::ReadWrite)) ([Windows.Storage.Streams.IRandomAccessStream])
  $opts = New-Object Windows.Data.Pdf.PdfPageRenderOptions
  $opts.DestinationWidth = [uint32]($page.Size.Width * $Scale)
  AwaitAct ($page.RenderToStreamAsync($stream, $opts))
  $stream.Dispose()
  # PdfPage has no Close() on some Windows builds — ignore, the render is done.
  try { $page.Close() } catch {}
  # Never claim a write that produced nothing: an empty PNG reads as "no figure
  # on this slide" and quietly licenses authoring a diagram nobody looked at.
  $len = (Get-Item $dest).Length
  if ($len -gt 0) { Write-Output "WROTE $dest ($len bytes)" }
  else { Write-Output "FAILED page $p - 0 bytes written" }
}
