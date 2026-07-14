using System.Runtime.InteropServices;

namespace RemoteAgent;

// Mouse/keyboard injection via SendInput. A true C union (LayoutKind.Explicit)
// makes this far less error-prone than hand-padding a Go struct to match
// MOUSEINPUT/KEYBDINPUT's shared size.
internal static class InputInjector
{
    [StructLayout(LayoutKind.Sequential)]
    struct MOUSEINPUT
    {
        public int dx, dy;
        public uint mouseData, dwFlags, time;
        public IntPtr dwExtraInfo;
    }

    [StructLayout(LayoutKind.Sequential)]
    struct KEYBDINPUT
    {
        public ushort wVk, wScan;
        public uint dwFlags, time;
        public IntPtr dwExtraInfo;
    }

    [StructLayout(LayoutKind.Explicit)]
    struct InputUnion
    {
        [FieldOffset(0)] public MOUSEINPUT mi;
        [FieldOffset(0)] public KEYBDINPUT ki;
    }

    [StructLayout(LayoutKind.Sequential)]
    struct INPUT
    {
        public uint type;
        public InputUnion u;
    }

    const uint INPUT_MOUSE = 0, INPUT_KEYBOARD = 1;
    const uint MOUSEEVENTF_MOVE = 0x0001, MOUSEEVENTF_ABSOLUTE = 0x8000;
    const uint MOUSEEVENTF_LEFTDOWN = 0x0002, MOUSEEVENTF_LEFTUP = 0x0004;
    const uint MOUSEEVENTF_RIGHTDOWN = 0x0008, MOUSEEVENTF_RIGHTUP = 0x0010;
    const uint MOUSEEVENTF_MIDDLEDOWN = 0x0020, MOUSEEVENTF_MIDDLEUP = 0x0040;
    const uint MOUSEEVENTF_WHEEL = 0x0800;
    const uint KEYEVENTF_KEYUP = 0x0002, KEYEVENTF_UNICODE = 0x0004;

    [DllImport("user32.dll", SetLastError = true)]
    static extern uint SendInput(uint nInputs, INPUT[] pInputs, int cbSize);

    static void Send(INPUT input) => SendInput(1, new[] { input }, Marshal.SizeOf<INPUT>());

    static double Clamp01(double v) => v < 0 ? 0 : v > 1 ? 1 : v;

    public static void MouseMove(double xNorm, double yNorm) =>
        Send(new INPUT
        {
            type = INPUT_MOUSE,
            u = new InputUnion
            {
                mi = new MOUSEINPUT
                {
                    dx = (int)(Clamp01(xNorm) * 65535),
                    dy = (int)(Clamp01(yNorm) * 65535),
                    dwFlags = MOUSEEVENTF_MOVE | MOUSEEVENTF_ABSOLUTE,
                },
            },
        });

    public static void MouseButton(string button, bool down)
    {
        var flags = button switch
        {
            "right" => down ? MOUSEEVENTF_RIGHTDOWN : MOUSEEVENTF_RIGHTUP,
            "middle" => down ? MOUSEEVENTF_MIDDLEDOWN : MOUSEEVENTF_MIDDLEUP,
            _ => down ? MOUSEEVENTF_LEFTDOWN : MOUSEEVENTF_LEFTUP,
        };
        Send(new INPUT { type = INPUT_MOUSE, u = new InputUnion { mi = new MOUSEINPUT { dwFlags = flags } } });
    }

    public static void Scroll(double dy) =>
        Send(new INPUT
        {
            type = INPUT_MOUSE,
            u = new InputUnion { mi = new MOUSEINPUT { dwFlags = MOUSEEVENTF_WHEEL, mouseData = unchecked((uint)(int)-dy) } },
        });

    static readonly HashSet<ushort> heldKeys = new();
    static readonly object heldLock = new();

    public static void Key(string code, bool down)
    {
        if (!KeyMap.CodeToVk.TryGetValue(code, out var vk)) return;
        var flags = down ? 0u : KEYEVENTF_KEYUP;
        Send(new INPUT { type = INPUT_KEYBOARD, u = new InputUnion { ki = new KEYBDINPUT { wVk = vk, dwFlags = flags } } });
        lock (heldLock)
        {
            if (down) heldKeys.Add(vk); else heldKeys.Remove(vk);
        }
    }

    // Disconnect safety net: a viewer that drops mid-keypress shouldn't leave
    // a modifier or letter key stuck down on the controlled machine.
    public static void ReleaseAllKeys()
    {
        ushort[] vks;
        lock (heldLock)
        {
            vks = heldKeys.ToArray();
            heldKeys.Clear();
        }
        foreach (var vk in vks)
            Send(new INPUT { type = INPUT_KEYBOARD, u = new InputUnion { ki = new KEYBDINPUT { wVk = vk, dwFlags = KEYEVENTF_KEYUP } } });
    }

    // Unicode injection for mobile soft-keyboard text, which arrives as
    // committed text rather than discrete physical key codes.
    public static void TypeText(string text)
    {
        foreach (var ch in text)
        {
            Send(new INPUT { type = INPUT_KEYBOARD, u = new InputUnion { ki = new KEYBDINPUT { wScan = ch, dwFlags = KEYEVENTF_UNICODE } } });
            Send(new INPUT { type = INPUT_KEYBOARD, u = new InputUnion { ki = new KEYBDINPUT { wScan = ch, dwFlags = KEYEVENTF_UNICODE | KEYEVENTF_KEYUP } } });
        }
    }
}
