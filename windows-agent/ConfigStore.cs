using System.Security.Cryptography;
using System.Text.Json;

namespace RemoteAgent;

internal record AgentConfig(int Port, string Token);

internal static class ConfigStore
{
    static string PathNextToExe => Path.Combine(AppContext.BaseDirectory, "remoteagent.json");

    public static AgentConfig LoadOrCreate()
    {
        var path = PathNextToExe;
        if (File.Exists(path))
        {
            try
            {
                var cfg = JsonSerializer.Deserialize<AgentConfig>(File.ReadAllText(path));
                if (cfg is { Port: > 0 } && !string.IsNullOrEmpty(cfg.Token))
                    return cfg;
            }
            catch
            {
                // fall through and regenerate a fresh config
            }
        }

        var token = Convert.ToHexString(RandomNumberGenerator.GetBytes(16)).ToLowerInvariant();
        var fresh = new AgentConfig(8791, token);
        File.WriteAllText(path, JsonSerializer.Serialize(fresh));
        return fresh;
    }
}
