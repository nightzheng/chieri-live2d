param([int]$Port = 8765)
# Minimal static file server for the Live2D-style viewer (no Node/Python needed).
if ($env:PORT) { $Port = [int]$env:PORT }
$root = $PSScriptRoot
$listener = New-Object System.Net.HttpListener
$listener.Prefixes.Add("http://localhost:$Port/")
$listener.Start()
Write-Host "Serving $root at http://localhost:$Port/"
$types = @{ '.html'='text/html; charset=utf-8'; '.js'='text/javascript; charset=utf-8'; '.css'='text/css'; '.png'='image/png'; '.jpg'='image/jpeg'; '.json'='application/json'; '.svg'='image/svg+xml' }
while ($listener.IsListening) {
  $ctx = $listener.GetContext()
  $req = $ctx.Request; $res = $ctx.Response
  try {
    $path = [Uri]::UnescapeDataString($req.Url.AbsolutePath).TrimStart('/')
    # dev only (set L2D_DEV=1): tools/frames.html writes its baked output into seq/
    if ($env:L2D_DEV -eq '1' -and $req.HttpMethod -eq 'POST' -and $path -like '__save/seq/*') {
      $rel = $path.Substring(7); $out = [IO.Path]::GetFullPath((Join-Path $root $rel))
      if ($out.StartsWith((Join-Path $root 'seq'))) {
        New-Item -ItemType Directory -Force (Split-Path $out) | Out-Null
        $ms = New-Object IO.MemoryStream; $req.InputStream.CopyTo($ms); [IO.File]::WriteAllBytes($out, $ms.ToArray())
      } else { $res.StatusCode = 403 }
      $res.Close(); continue
    }
    if ($path -eq '') { $path = 'index.html' }
    $full = [IO.Path]::GetFullPath((Join-Path $root $path))
    if ($full.StartsWith($root) -and (Test-Path $full -PathType Leaf)) {
      $bytes = [IO.File]::ReadAllBytes($full)
      $ext = [IO.Path]::GetExtension($full).ToLower()
      if ($types.ContainsKey($ext)) { $res.ContentType = $types[$ext] }
      $res.Headers.Add('Cache-Control', 'no-store')
      $res.OutputStream.Write($bytes, 0, $bytes.Length)
    } else { $res.StatusCode = 404 }
  } catch { $res.StatusCode = 500 }
  $res.Close()
}
