# Compare each backed-up source against its copy on H:. Deletes nothing.
$dest = 'H:\Backup-Lenovo-2026-09-05'
$pairs = @(
  @{ src = 'D:\Agentic';                      dst = "$dest\proyek-ai-lama\Agentic" },
  @{ src = 'D:\Agentic-Trading';              dst = "$dest\proyek-ai-lama\Agentic-Trading" },
  @{ src = 'D:\aidit dan ann';                dst = "$dest\proyek-ai-lama\aidit dan ann" },
  @{ src = 'D:\aidit-restore';                dst = "$dest\proyek-ai-lama\aidit-restore" },
  @{ src = 'D:\Claude';                       dst = "$dest\claude-desktop\Claude" },
  @{ src = 'D:\Claude Workspace';             dst = "$dest\claude-desktop\Claude Workspace" },
  @{ src = 'D:\AI\paperclip-backup-20260904'; dst = "$dest\backup-installer\paperclip-backup-20260904" },
  @{ src = 'D:\paperclip-companies';          dst = "$dest\backup-installer\paperclip-companies" },
  @{ src = 'D:\AI\_installers';               dst = "$dest\backup-installer\_installers" },
  @{ src = 'D:\AI\.claude-flow';              dst = "$dest\claude-flow-state\.claude-flow" },
  @{ src = 'D:\AI\.swarm';                    dst = "$dest\claude-flow-state\.swarm" },
  @{ src = 'D:\AI\blobs';                     dst = "$dest\claude-flow-state\blobs" },
  @{ src = 'D:\AI\manifests';                 dst = "$dest\claude-flow-state\manifests" }
)

function Stat($p) {
  if (-not (Test-Path $p)) { return @{ files = -1; bytes = -1 } }
  $f = Get-ChildItem $p -Recurse -File -Force -ErrorAction SilentlyContinue
  $sum = ($f | Measure-Object Length -Sum).Sum
  return @{ files = @($f).Count; bytes = [int64]($sum) }
}

$allOk = $true
foreach ($p in $pairs) {
  $s = Stat $p.src
  $d = Stat $p.dst
  if ($s.files -lt 0) { "SKIP  (source gone)  $($p.src)"; continue }
  $ok = ($s.files -eq $d.files) -and ($s.bytes -eq $d.bytes)
  if (-not $ok) { $allOk = $false }
  $verdict = if ($ok) { 'MATCH' } else { 'MISMATCH' }
  "{0,-9} {1,-42} src={2,6} files / {3,10} B   dst={4,6} / {5,10} B" -f $verdict, (Split-Path $p.src -Leaf), $s.files, $s.bytes, $d.files, $d.bytes
}
if ($allOk) { 'ALL GROUPS VERIFIED' } else { 'SOME GROUPS DO NOT MATCH - NOTHING SHOULD BE DELETED' }
