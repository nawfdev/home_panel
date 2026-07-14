using System.Net;
using System.Net.Sockets;
using System.Net.WebSockets;
using System.Security.Cryptography;
using System.Text;
using System.Text.Json;

namespace RemoteAgent;

// Raw TcpListener + a hand-rolled WebSocket handshake instead of HttpListener:
// HttpListener's wildcard host binding ("+"/"*") needs a URL ACL reservation
// or admin rights to accept LAN connections, which would mean telling every
// user to run this elevated. A plain socket bound to IPAddress.Any has no
// such restriction, so "just run the exe" keeps working for a normal user.
internal sealed class WsServer
{
    const string WebSocketGuid = "258EAFA5-E914-47DA-95CA-C5AB0DC85B11";

    readonly AgentConfig _cfg;
    TcpListener? _listener;

    public event Action? ViewerConnected;
    public event Action? ViewerDisconnected;
    public event Action<string>? FileReceived;

    public WsServer(AgentConfig cfg) => _cfg = cfg;

    public void Start()
    {
        _listener = new TcpListener(IPAddress.Any, _cfg.Port);
        _listener.Start();
        _ = AcceptLoop();
    }

    async Task AcceptLoop()
    {
        while (true)
        {
            TcpClient client;
            try { client = await _listener!.AcceptTcpClientAsync(); }
            catch { return; }
            _ = HandleClient(client);
        }
    }

    async Task HandleClient(TcpClient client)
    {
        using var _ = client;
        // Nagle's algorithm batches small writes to reduce packet count, but
        // for a live screen/input stream it just adds latency waiting to
        // coalesce — each JPEG frame/input event should go out immediately.
        client.NoDelay = true;
        var stream = client.GetStream();
        var (path, query, secWebSocketKey) = await ReadHandshake(stream);
        if (path is null) return;

        var token = ParseQueryValue(query, "token");
        if (path != "/ws" || secWebSocketKey is null || token != _cfg.Token)
        {
            var body = Encoding.UTF8.GetBytes(path == "/ws" ? "invalid token" : "Remote Desktop agent running");
            var resp = Encoding.ASCII.GetBytes(
                $"HTTP/1.1 {(path == "/ws" ? "401 Unauthorized" : "200 OK")}\r\nContent-Length: {body.Length}\r\nConnection: close\r\n\r\n");
            await stream.WriteAsync(resp);
            await stream.WriteAsync(body);
            return;
        }

        var accept = Convert.ToBase64String(SHA1.HashData(Encoding.ASCII.GetBytes(secWebSocketKey + WebSocketGuid)));
        var switchResp = Encoding.ASCII.GetBytes(
            "HTTP/1.1 101 Switching Protocols\r\n" +
            "Upgrade: websocket\r\n" +
            "Connection: Upgrade\r\n" +
            $"Sec-WebSocket-Accept: {accept}\r\n\r\n");
        await stream.WriteAsync(switchResp);

        using var socket = WebSocket.CreateFromStream(stream, isServer: true, subProtocol: null, TimeSpan.FromSeconds(30));
        await ServeConnection(socket);
    }

    static async Task<(string? path, string query, string? key)> ReadHandshake(NetworkStream stream)
    {
        var headerBytes = new List<byte>();
        var buf = new byte[1];
        // Read until the blank line terminating the HTTP request headers.
        while (headerBytes.Count < 16 * 1024)
        {
            var read = await stream.ReadAsync(buf);
            if (read == 0) return (null, "", null);
            headerBytes.Add(buf[0]);
            if (headerBytes.Count >= 4 &&
                headerBytes[^4] == '\r' && headerBytes[^3] == '\n' && headerBytes[^2] == '\r' && headerBytes[^1] == '\n')
                break;
        }

        var text = Encoding.ASCII.GetString(headerBytes.ToArray());
        var lines = text.Split("\r\n", StringSplitOptions.RemoveEmptyEntries);
        if (lines.Length == 0) return (null, "", null);

        var requestParts = lines[0].Split(' ');
        if (requestParts.Length < 2) return (null, "", null);
        var target = requestParts[1];
        var qIdx = target.IndexOf('?');
        var path = qIdx >= 0 ? target[..qIdx] : target;
        var query = qIdx >= 0 ? target[(qIdx + 1)..] : "";

        string? key = null;
        foreach (var line in lines.Skip(1))
        {
            var idx = line.IndexOf(':');
            if (idx < 0) continue;
            var name = line[..idx].Trim();
            var value = line[(idx + 1)..].Trim();
            if (name.Equals("Sec-WebSocket-Key", StringComparison.OrdinalIgnoreCase)) key = value;
        }
        return (path, query, key);
    }

    static string? ParseQueryValue(string query, string name)
    {
        foreach (var pair in query.Split('&', StringSplitOptions.RemoveEmptyEntries))
        {
            var idx = pair.IndexOf('=');
            var k = idx < 0 ? pair : pair[..idx];
            if (!k.Equals(name, StringComparison.OrdinalIgnoreCase)) continue;
            var v = idx < 0 ? "" : pair[(idx + 1)..];
            return Uri.UnescapeDataString(v);
        }
        return null;
    }

    async Task ServeConnection(WebSocket socket)
    {
        ViewerConnected?.Invoke();
        using var cts = new CancellationTokenSource();
        var sendLock = new SemaphoreSlim(1, 1);
        FileReceiver? receiving = null;
        var lastClipboardFromViewer = "";

        var frameTask = StreamScreen(socket, sendLock, cts.Token);
        var clipTask = ClipboardWatcher(socket, sendLock, cts.Token, () => lastClipboardFromViewer);

        using var audio = new AudioCaptureService();
        audio.AudioAvailable += async pcm =>
        {
            if (cts.IsCancellationRequested || socket.State != WebSocketState.Open) return;
            var framed = new byte[pcm.Length + 1];
            framed[0] = 0x03;
            Buffer.BlockCopy(pcm, 0, framed, 1, pcm.Length);
            // Best-effort: if another send is in flight, drop this chunk
            // rather than block the audio capture thread.
            if (!await sendLock.WaitAsync(0)) return;
            try { await socket.SendAsync(framed, WebSocketMessageType.Binary, true, CancellationToken.None); }
            catch { /* connection dropped mid-send */ }
            finally { sendLock.Release(); }
        };

        var buffer = new byte[64 * 1024];
        try
        {
            while (socket.State == WebSocketState.Open)
            {
                using var ms = new MemoryStream();
                WebSocketReceiveResult result;
                do
                {
                    result = await socket.ReceiveAsync(buffer, CancellationToken.None);
                    if (result.MessageType == WebSocketMessageType.Close) return;
                    ms.Write(buffer, 0, result.Count);
                } while (!result.EndOfMessage);

                if (result.MessageType == WebSocketMessageType.Binary)
                {
                    var data = ms.ToArray();
                    if (receiving is not null)
                    {
                        receiving.Write(data);
                    }
                    continue;
                }

                var text = Encoding.UTF8.GetString(ms.ToArray());
                HandleControlMessage(text, ref receiving, ref lastClipboardFromViewer, audio);
            }
        }
        catch
        {
            // connection dropped
        }
        finally
        {
            cts.Cancel();
            InputInjector.ReleaseAllKeys();
            ViewerDisconnected?.Invoke();
            try { await Task.WhenAll(frameTask, clipTask); } catch { /* expected on cancel */ }
        }
    }

    void HandleControlMessage(string json, ref FileReceiver? receiving, ref string lastClipboardFromViewer, AudioCaptureService audio)
    {
        JsonElement msg;
        try { msg = JsonDocument.Parse(json).RootElement; }
        catch { return; }

        var type = msg.TryGetProperty("type", out var t) ? t.GetString() : null;
        switch (type)
        {
            case "mouse_move":
                InputInjector.MouseMove(GetDouble(msg, "x"), GetDouble(msg, "y"));
                break;
            case "mouse_down":
                InputInjector.MouseButton(GetString(msg, "button") ?? "left", true);
                break;
            case "mouse_up":
                InputInjector.MouseButton(GetString(msg, "button") ?? "left", false);
                break;
            case "scroll":
                InputInjector.Scroll(GetDouble(msg, "dy"));
                break;
            case "key_down":
                InputInjector.Key(GetString(msg, "code") ?? "", true);
                break;
            case "key_up":
                InputInjector.Key(GetString(msg, "code") ?? "", false);
                break;
            case "type_text":
                InputInjector.TypeText(GetString(msg, "text") ?? "");
                break;
            case "audio_on":
                audio.Start();
                break;
            case "audio_off":
                audio.Stop();
                break;
            case "clipboard":
                var clipText = GetString(msg, "text") ?? "";
                lastClipboardFromViewer = clipText;
                TrySetClipboard(clipText);
                break;
            case "file_offer":
                receiving = FileReceiver.Create(GetString(msg, "name") ?? "file");
                break;
            case "file_end":
                if (receiving is not null)
                {
                    var name = receiving.Finish();
                    if (name is not null) FileReceived?.Invoke(name);
                    receiving = null;
                }
                break;
        }
    }

    static void TrySetClipboard(string text)
    {
        try
        {
            var thread = new Thread(() => { try { Clipboard.SetText(text); } catch { } });
            thread.SetApartmentState(ApartmentState.STA);
            thread.Start();
            thread.Join(500);
        }
        catch { /* clipboard access can transiently fail; not fatal */ }
    }

    static double GetDouble(JsonElement e, string name) =>
        e.TryGetProperty(name, out var v) && v.TryGetDouble(out var d) ? d : 0;

    static string? GetString(JsonElement e, string name) =>
        e.TryGetProperty(name, out var v) ? v.GetString() : null;

    async Task StreamScreen(WebSocket socket, SemaphoreSlim sendLock, CancellationToken ct)
    {
        try
        {
            while (!ct.IsCancellationRequested && socket.State == WebSocketState.Open)
            {
                await Task.Delay(120, ct);
                var jpeg = CaptureService.CaptureJpeg();
                var framed = new byte[jpeg.Length + 1];
                framed[0] = 0x01;
                Buffer.BlockCopy(jpeg, 0, framed, 1, jpeg.Length);
                await sendLock.WaitAsync(ct);
                try { await socket.SendAsync(framed, WebSocketMessageType.Binary, true, ct); }
                finally { sendLock.Release(); }
            }
        }
        catch (OperationCanceledException) { }
        catch { }
    }

    async Task ClipboardWatcher(WebSocket socket, SemaphoreSlim sendLock, CancellationToken ct, Func<string> lastFromViewer)
    {
        var last = "";
        try
        {
            while (!ct.IsCancellationRequested && socket.State == WebSocketState.Open)
            {
                await Task.Delay(1000, ct);
                var cur = TryGetClipboard();
                if (cur is null || cur == last || cur == lastFromViewer()) continue;
                last = cur;
                var json = JsonSerializer.Serialize(new { type = "clipboard", text = cur });
                var bytes = Encoding.UTF8.GetBytes(json);
                await sendLock.WaitAsync(ct);
                try { await socket.SendAsync(bytes, WebSocketMessageType.Text, true, ct); }
                finally { sendLock.Release(); }
            }
        }
        catch (OperationCanceledException) { }
        catch { }
    }

    static string? TryGetClipboard()
    {
        string? result = null;
        try
        {
            var thread = new Thread(() => { try { result = Clipboard.ContainsText() ? Clipboard.GetText() : null; } catch { } });
            thread.SetApartmentState(ApartmentState.STA);
            thread.Start();
            thread.Join(500);
        }
        catch { }
        return result;
    }
}

// Buffers an in-flight upload from the viewer and flushes it to disk on
// file_end. Filenames are sanitized to a bare basename so a remote peer
// can't write outside the target directory.
internal sealed class FileReceiver
{
    readonly FileStream _stream;

    FileReceiver(FileStream stream) => _stream = stream;

    public static FileReceiver? Create(string name)
    {
        try
        {
            var dir = Path.Combine(
                Environment.GetFolderPath(Environment.SpecialFolder.UserProfile), "Downloads", "RemoteAgentReceived");
            Directory.CreateDirectory(dir);
            var safeName = Path.GetFileName(name);
            var stream = File.Create(Path.Combine(dir, safeName));
            return new FileReceiver(stream);
        }
        catch
        {
            return null;
        }
    }

    public void Write(byte[] data)
    {
        if (data.Length == 0) return;
        // Strip the leading 0x02 tag byte set by the browser's chunk framing.
        var offset = data[0] == 0x02 ? 1 : 0;
        _stream.Write(data, offset, data.Length - offset);
    }

    public string? Finish()
    {
        try
        {
            var name = Path.GetFileName(_stream.Name);
            _stream.Dispose();
            return name;
        }
        catch
        {
            return null;
        }
    }
}
