namespace RemoteAgent;

internal sealed class MainForm : Form
{
    readonly Label _statusLabel;
    readonly TextBox _logBox;
    readonly WsServer _server;

    public MainForm(AgentConfig cfg)
    {
        Text = "Home Panel — Remote Desktop Agent";
        ClientSize = new Size(440, 360);
        MinimumSize = new Size(400, 300);
        StartPosition = FormStartPosition.CenterScreen;
        Font = new Font("Segoe UI", 9F);
        Padding = new Padding(16);

        var layout = new TableLayoutPanel
        {
            Dock = DockStyle.Fill,
            ColumnCount = 1,
            RowCount = 8,
        };
        layout.RowStyles.Add(new RowStyle(SizeType.AutoSize));
        layout.RowStyles.Add(new RowStyle(SizeType.AutoSize));
        layout.RowStyles.Add(new RowStyle(SizeType.AutoSize));
        layout.RowStyles.Add(new RowStyle(SizeType.AutoSize));
        layout.RowStyles.Add(new RowStyle(SizeType.AutoSize));
        layout.RowStyles.Add(new RowStyle(SizeType.AutoSize));
        layout.RowStyles.Add(new RowStyle(SizeType.Percent, 100));
        layout.RowStyles.Add(new RowStyle(SizeType.AutoSize));
        Controls.Add(layout);

        layout.Controls.Add(new Label { Text = $"Port: {cfg.Port}", AutoSize = true, Font = new Font(Font, FontStyle.Bold) });

        layout.Controls.Add(new Label { Text = "LAN IP (enter this in the panel):", AutoSize = true, Margin = new Padding(0, 8, 0, 2) });
        var lanIp = NetworkInfo.GetLikelyLanIp();
        var ipRow = new TableLayoutPanel { Dock = DockStyle.Top, ColumnCount = 2, AutoSize = true, Height = 28 };
        ipRow.ColumnStyles.Add(new ColumnStyle(SizeType.Percent, 100));
        ipRow.ColumnStyles.Add(new ColumnStyle(SizeType.AutoSize));
        var ipBox = new TextBox { Text = lanIp, ReadOnly = true, Dock = DockStyle.Fill, Font = new Font("Consolas", 9F) };
        var copyIpButton = new Button { Text = "Copy", AutoSize = true };
        copyIpButton.Click += (_, _) => Clipboard.SetText(lanIp);
        ipRow.Controls.Add(ipBox, 0, 0);
        ipRow.Controls.Add(copyIpButton, 1, 0);
        layout.Controls.Add(ipRow);

        layout.Controls.Add(new Label { Text = "Token (enter this in the panel):", AutoSize = true, Margin = new Padding(0, 8, 0, 2) });

        var tokenRow = new TableLayoutPanel { Dock = DockStyle.Top, ColumnCount = 2, AutoSize = true, Height = 28 };
        tokenRow.ColumnStyles.Add(new ColumnStyle(SizeType.Percent, 100));
        tokenRow.ColumnStyles.Add(new ColumnStyle(SizeType.AutoSize));
        var tokenBox = new TextBox { Text = cfg.Token, ReadOnly = true, Dock = DockStyle.Fill, Font = new Font("Consolas", 9F) };
        var copyButton = new Button { Text = "Copy", AutoSize = true };
        copyButton.Click += (_, _) => Clipboard.SetText(cfg.Token);
        tokenRow.Controls.Add(tokenBox, 0, 0);
        tokenRow.Controls.Add(copyButton, 1, 0);
        layout.Controls.Add(tokenRow);

        _statusLabel = new Label
        {
            Text = "Waiting for a viewer to connect…",
            AutoSize = true,
            Margin = new Padding(0, 10, 0, 4),
            ForeColor = Color.DarkOrange,
        };
        layout.Controls.Add(_statusLabel);

        layout.Controls.Add(new Label { Text = "Activity:", AutoSize = true });

        _logBox = new TextBox
        {
            Multiline = true,
            ReadOnly = true,
            ScrollBars = ScrollBars.Vertical,
            Dock = DockStyle.Fill,
            Font = new Font("Consolas", 8.5F),
        };
        layout.Controls.Add(_logBox);

        layout.Controls.Add(new Label
        {
            Text = "Add this device in the panel's Remote Desktop page with this machine's LAN IP, " +
                   "the port and token above. Closing this window stops the agent.",
            AutoSize = true,
            MaximumSize = new Size(400, 0),
            ForeColor = Color.Gray,
            Margin = new Padding(0, 8, 0, 0),
        });

        _server = new WsServer(cfg);
        _server.ViewerConnected += () => Invoke(() =>
        {
            _statusLabel.Text = "Viewer connected";
            _statusLabel.ForeColor = Color.SeaGreen;
            AppendLog("Viewer connected");
        });
        _server.ViewerDisconnected += () => Invoke(() =>
        {
            _statusLabel.Text = "Waiting for a viewer to connect…";
            _statusLabel.ForeColor = Color.DarkOrange;
            AppendLog("Viewer disconnected");
        });
        _server.FileReceived += name => Invoke(() => AppendLog($"Received file: {name}"));
        _server.Start();
    }

    void AppendLog(string line) => _logBox.AppendText($"[{DateTime.Now:HH:mm:ss}] {line}{Environment.NewLine}");
}
