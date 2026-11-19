'use strict';

const { execFile } = require('node:child_process');
const path = require('node:path');
const { promisify } = require('node:util');

const exec = promisify(execFile);
const script = Buffer.from(String.raw`
$ErrorActionPreference = 'Stop'
Add-Type @'
using System;
using System.Runtime.InteropServices;
public static class ChieriWindow {
  [DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr window, out uint process);
}
'@
$ownerId = [uint32]0
$threadId = [ChieriWindow]::GetWindowThreadProcessId([IntPtr][long]$env:CHIERI_VISION_WINDOW, [ref]$ownerId)
if ($threadId -and $ownerId) {
  $owner = Get-Process -Id $ownerId
  Write-Output "$ownerId/$threadId/$($owner.StartTime.ToUniversalTime().Ticks)"
}
`, 'utf16le').toString('base64');

async function windowIdentity(sourceId) {
  const handle = /^window:(\d{1,15}):\d+$/.exec(sourceId)?.[1];
  if (process.platform !== 'win32' || !handle) return '';
  const powershell = path.join(process.env.SystemRoot || 'C:\\Windows', 'System32/WindowsPowerShell/v1.0/powershell.exe');
  try {
    const { stdout } = await exec(powershell, ['-NoLogo', '-NoProfile', '-NonInteractive', '-EncodedCommand', script], {
      windowsHide: true, timeout: 2500, env: { ...process.env, CHIERI_VISION_WINDOW: handle },
    });
    const identity = stdout.trim();
    return /^\d+\/\d+\/\d+$/.test(identity) ? identity : '';
  } catch (_) { return ''; }
}

module.exports = { windowIdentity };
