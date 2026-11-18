$ErrorActionPreference = 'Stop'
Add-Type -TypeDefinition @'
using System;
using System.Runtime.InteropServices;
using System.Text;
using System.Threading;

public static class PetFullscreen {
    [StructLayout(LayoutKind.Sequential)]
    private struct Rect { public int Left, Top, Right, Bottom; }

    [StructLayout(LayoutKind.Sequential)]
    private struct MonitorInfo {
        public int Size;
        public Rect Bounds, Work;
        public uint Flags;
    }

    [DllImport("user32.dll")] private static extern IntPtr GetForegroundWindow();
    [DllImport("user32.dll")] private static extern IntPtr GetShellWindow();
    [DllImport("user32.dll")] private static extern bool IsWindow(IntPtr window);
    [DllImport("user32.dll")] private static extern bool IsIconic(IntPtr window);
    [DllImport("user32.dll")] private static extern bool IsZoomed(IntPtr window);
    [DllImport("user32.dll")] private static extern int GetWindowLong(IntPtr window, int index);
    [DllImport("user32.dll")] private static extern IntPtr SetThreadDpiAwarenessContext(IntPtr value);
    [DllImport("user32.dll")] private static extern uint GetWindowThreadProcessId(IntPtr window, out uint process);
    [DllImport("user32.dll", CharSet = CharSet.Unicode)]
    private static extern int GetClassName(IntPtr window, StringBuilder name, int length);
    [DllImport("user32.dll")] private static extern IntPtr MonitorFromWindow(IntPtr window, uint flags);
    [DllImport("user32.dll", CharSet = CharSet.Unicode)]
    private static extern bool GetMonitorInfo(IntPtr monitor, ref MonitorInfo info);
    [DllImport("dwmapi.dll")]
    private static extern int DwmGetWindowAttribute(IntPtr window, int attribute, out Rect bounds, int size);

    public static bool Covered(IntPtr pet, uint owner, IntPtr front) {
        if (front == IntPtr.Zero || front == GetShellWindow() || IsIconic(front)) return false;
        uint process;
        GetWindowThreadProcessId(front, out process);
        if (process == owner) return false;
        var name = new StringBuilder(64);
        GetClassName(front, name, name.Capacity);
        switch (name.ToString()) {
            case "Progman": case "WorkerW": case "Shell_TrayWnd": case "Shell_SecondaryTrayWnd":
                return false;
        }
        // A maximized captioned window can fill the monitor when the taskbar auto-hides.
        const int caption = 0x00C00000;
        if (IsZoomed(front) && (GetWindowLong(front, -16) & caption) == caption) return false;
        IntPtr monitor = MonitorFromWindow(pet, 2);
        if (monitor == IntPtr.Zero) return false;
        var info = new MonitorInfo();
        info.Size = Marshal.SizeOf(typeof(MonitorInfo));
        Rect window;
        if (!GetMonitorInfo(monitor, ref info) || DwmGetWindowAttribute(front, 9, out window, Marshal.SizeOf(typeof(Rect))) != 0)
            return false;
        Rect screen = info.Bounds;
        return window.Left <= screen.Left + 1 && window.Top <= screen.Top + 1 &&
            window.Right >= screen.Right - 1 && window.Bottom >= screen.Bottom - 1;
    }

    public static void Watch(long handle, uint owner) {
        SetThreadDpiAwarenessContext(new IntPtr(-4));
        IntPtr pet = new IntPtr(handle);
        // EOF on the private pipe also stops the helper if Electron exits unexpectedly.
        var pipe = Console.OpenStandardInput();
        var closing = pipe.ReadAsync(new byte[1], 0, 1);
        bool? last = null;
        while (!closing.IsCompleted && IsWindow(pet)) {
            bool covered = Covered(pet, owner, GetForegroundWindow());
            if (last != covered) {
                Console.WriteLine(covered ? "covered" : "clear");
                last = covered;
            }
            Thread.Sleep(150);
        }
    }
}
'@
[PetFullscreen]::Watch([long]$env:CHIERI_PET_HANDLE, [uint32]$env:CHIERI_PET_OWNER)
