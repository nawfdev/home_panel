namespace RemoteAgent;

// Maps JS KeyboardEvent.code (layout-independent, sent by the web viewer and
// the Android app) to Windows virtual-key codes for SendInput.
internal static class KeyMap
{
    public static readonly Dictionary<string, ushort> CodeToVk = Build();

    static Dictionary<string, ushort> Build()
    {
        var m = new Dictionary<string, ushort>
        {
            ["Enter"] = 0x0D, ["Escape"] = 0x1B, ["Backspace"] = 0x08, ["Tab"] = 0x09, ["Space"] = 0x20,
            ["ShiftLeft"] = 0xA0, ["ShiftRight"] = 0xA1, ["ControlLeft"] = 0xA2, ["ControlRight"] = 0xA3,
            ["AltLeft"] = 0xA4, ["AltRight"] = 0xA5, ["MetaLeft"] = 0x5B, ["MetaRight"] = 0x5C,
            ["ArrowUp"] = 0x26, ["ArrowDown"] = 0x28, ["ArrowLeft"] = 0x25, ["ArrowRight"] = 0x27,
            ["Home"] = 0x24, ["End"] = 0x23, ["PageUp"] = 0x21, ["PageDown"] = 0x22,
            ["Delete"] = 0x2E, ["Insert"] = 0x2D, ["CapsLock"] = 0x14,
            ["Minus"] = 0xBD, ["Equal"] = 0xBB, ["BracketLeft"] = 0xDB, ["BracketRight"] = 0xDD,
            ["Backslash"] = 0xDC, ["Semicolon"] = 0xBA, ["Quote"] = 0xDE,
            ["Comma"] = 0xBC, ["Period"] = 0xBE, ["Slash"] = 0xBF, ["Backquote"] = 0xC0,
        };
        for (var c = 'A'; c <= 'Z'; c++) m["Key" + c] = c;
        for (var d = '0'; d <= '9'; d++) m["Digit" + d] = d;
        for (var n = 0; n <= 9; n++) m["Numpad" + n] = (ushort)(0x60 + n);
        for (var f = 1; f <= 12; f++) m["F" + f] = (ushort)(0x70 + f - 1);
        return m;
    }
}
