namespace RemoteAgent;

internal static class Program
{
    [STAThread]
    static void Main()
    {
        ApplicationConfiguration.Initialize();
        var cfg = ConfigStore.LoadOrCreate();
        Application.Run(new MainForm(cfg));
    }
}
