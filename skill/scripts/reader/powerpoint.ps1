# Renders every slide of <Folder>\deck.pptx to <Folder>\slide-001.png... through PowerPoint's own
# export. Run by slides.py (keep this file ASCII: Windows PowerShell reads it in the ANSI code page).
# Exits 10 when PowerPoint isn't installed and 11 when it won't start, with the message on stderr.
# Otherwise prints {"slides": <count or null>, "leftRunning": <bool>} and exits 0, or 12 (message on
# stderr) when PowerPoint failed on the deck. PowerPoint is quit before exiting, unless -LeaveRunning
# (it was running before the read) or it holds another presentation (the Owner opened PowerPoint
# during the read, and got this instance): then only the deck is closed.
param(
    [Parameter(Mandatory = $true)] [string] $Folder,
    [Parameter(Mandatory = $true)] [int] $Dpi,
    [string] $ProgId = "PowerPoint.Application",
    [switch] $LeaveRunning
)
$ErrorActionPreference = "Stop"

function Fail([int] $Code, [string] $Message) {
    [Console]::Error.WriteLine($Message)
    exit $Code
}

$type = [Type]::GetTypeFromProgID($ProgId)
if ($null -eq $type) {
    Fail 10 ("PowerPoint is not installed (no COM class $ProgId): the reader renders a deck's " +
        "slides through PowerPoint's own export, so install PowerPoint on this machine")
}
try {
    $app = [Activator]::CreateInstance($type)
} catch {
    Fail 11 "PowerPoint is installed but failed to start: $($_.Exception.GetBaseException().Message)"
}

$code = 0
$count = "null"
$presentation = $null
$alerts = $app.DisplayAlerts
try {
    $app.DisplayAlerts = 1  # ppAlertsNone: no dialog can stall an unattended read
    # Read-only, not untitled, no window.
    $presentation = $app.Presentations.Open((Join-Path $Folder "deck.pptx"), -1, 0, 0)
    $width = [int][Math]::Round($presentation.PageSetup.SlideWidth * $Dpi / 72)
    $height = [int][Math]::Round($presentation.PageSetup.SlideHeight * $Dpi / 72)
    for ($n = 1; $n -le $presentation.Slides.Count; $n++) {
        $png = Join-Path $Folder ("slide-{0:D3}.png" -f $n)
        $presentation.Slides.Item($n).Export($png, "PNG", $width, $height)
    }
    $count = $presentation.Slides.Count
} catch {
    [Console]::Error.WriteLine("PowerPoint failed on the deck: $($_.Exception.GetBaseException().Message)")
    $code = 12
} finally {
    # Each step on its own, so one failing still runs the rest.
    if ($null -ne $presentation) { try { $presentation.Close() } catch {} }
    $others = 0
    try { $others = $app.Presentations.Count } catch {}
    $stay = $LeaveRunning -or $others -gt 0
    if ($stay) {
        try { $app.DisplayAlerts = $alerts } catch {}
    } else {
        try { $app.Quit() } catch {}
    }
    [void][Runtime.InteropServices.Marshal]::FinalReleaseComObject($app)
}
Write-Output ("{`"slides`": $count, `"leftRunning`": " + $(if ($stay) { "true" } else { "false" }) + "}")
exit $code
