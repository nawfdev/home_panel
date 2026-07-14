using System.Net.Sockets;

namespace RemoteAgent;

internal static class NetworkInfo
{
    // Opens a UDP "connection" (no packets actually sent — UDP connect just
    // picks the outbound route) to read back which local NIC/IP the OS would
    // use to reach the LAN/internet. The simplest reliable way to guess
    // "this machine's LAN IP" without guessing which of several NICs is right.
    public static string GetLikelyLanIp()
    {
        try
        {
            using var socket = new Socket(AddressFamily.InterNetwork, SocketType.Dgram, ProtocolType.Udp);
            socket.Connect("8.8.8.8", 65530);
            return (socket.LocalEndPoint as System.Net.IPEndPoint)?.Address.ToString() ?? "Unavailable";
        }
        catch
        {
            return "Unavailable";
        }
    }
}
