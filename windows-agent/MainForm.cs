using System.Drawing.Drawing2D;
using System.Runtime.InteropServices;

namespace RemoteAgent;

internal sealed class MainForm : Form
{
    [DllImport("dwmapi.dll")]
    private static extern int DwmSetWindowAttribute(IntPtr hwnd, int attr, ref int attrValue, int attrSize);

    private const int DWMWA_USE_IMMERSIVE_DARK_MODE = 20;

    private static readonly Color ColorBg = Color.FromArgb(10, 10, 11);
    private static readonly Color ColorSurface = Color.FromArgb(19, 19, 22);
    private static readonly Color ColorBorder = Color.FromArgb(39, 39, 42);
    private static readonly Color ColorTextPrimary = Color.FromArgb(250, 250, 250);
    private static readonly Color ColorTextSecondary = Color.FromArgb(212, 212, 216);
    private static readonly Color ColorTextMuted = Color.FromArgb(161, 161, 170);
    private static readonly Color ColorButtonBg = Color.FromArgb(24, 24, 27);
    private static readonly Color ColorButtonHover = Color.FromArgb(39, 39, 42);
    private static readonly Color ColorGreen = Color.FromArgb(74, 222, 128);
    private static readonly Color ColorYellow = Color.FromArgb(250, 204, 21);

    private readonly Label _statusDot;
    private readonly Label _statusText;
    private readonly TextBox _logBox;
    private readonly WsServer _server;
    private readonly NotifyIcon _trayIcon;
    private bool _reallyExit;

    public MainForm(AgentConfig cfg)
    {
        Text = "Nestcore — Remote Desktop Agent";
        ClientSize = new Size(460, 420);
        MinimumSize = new Size(420, 360);
        StartPosition = FormStartPosition.CenterScreen;
        Font = new Font("Segoe UI", 9F, FontStyle.Regular);
        BackColor = ColorBg;
        ForeColor = ColorTextPrimary;
        Padding = new Padding(20);
        Icon = SystemIcons.Application;

        EnableDarkTitleBar();

        var mainLayout = new TableLayoutPanel
        {
            Dock = DockStyle.Fill,
            ColumnCount = 1,
            RowCount = 6,
            BackColor = Color.Transparent,
        };
        mainLayout.ColumnStyles.Add(new ColumnStyle(SizeType.Percent, 100));
        mainLayout.RowStyles.Add(new RowStyle(SizeType.AutoSize)); // Header + Port
        mainLayout.RowStyles.Add(new RowStyle(SizeType.AutoSize)); // LAN IP row
        mainLayout.RowStyles.Add(new RowStyle(SizeType.AutoSize)); // Token row
        mainLayout.RowStyles.Add(new RowStyle(SizeType.AutoSize)); // Status Pill
        mainLayout.RowStyles.Add(new RowStyle(SizeType.Percent, 100)); // Log box
        mainLayout.RowStyles.Add(new RowStyle(SizeType.AutoSize)); // Footer

        // 1. Header (Brand + Port badge)
        var headerRow = new FlowLayoutPanel
        {
            Dock = DockStyle.Top,
            AutoSize = true,
            FlowDirection = FlowDirection.LeftToRight,
            Margin = new Padding(0, 0, 0, 14),
            BackColor = Color.Transparent,
        };

        var titleLabel = new Label
        {
            Text = "Remote Desktop Agent",
            Font = new Font("Segoe UI", 12F, FontStyle.Bold),
            ForeColor = ColorTextPrimary,
            AutoSize = true,
            Margin = new Padding(0, 0, 10, 0),
        };
        var portBadge = new Label
        {
            Text = $"PORT {cfg.Port}",
            Font = new Font("Consolas", 8.5F, FontStyle.Bold),
            ForeColor = ColorTextSecondary,
            BackColor = ColorSurface,
            Padding = new Padding(6, 3, 6, 3),
            AutoSize = true,
        };
        headerRow.Controls.Add(titleLabel);
        headerRow.Controls.Add(portBadge);
        mainLayout.Controls.Add(headerRow, 0, 0);

        // 2. LAN IP
        var lanIp = NetworkInfo.GetLikelyLanIp();
        mainLayout.Controls.Add(CreateLabeledInputRow("LAN IP (enter in panel):", lanIp), 0, 1);

        // 3. Token
        mainLayout.Controls.Add(CreateLabeledInputRow("Security Token (enter in panel):", cfg.Token), 0, 2);

        // 4. Status Badge Container
        var statusCard = new Panel
        {
            Dock = DockStyle.Top,
            Height = 36,
            Margin = new Padding(0, 4, 0, 10),
            BackColor = ColorSurface,
            Padding = new Padding(12, 6, 12, 6),
        };
        _statusDot = new Label
        {
            Text = "●",
            ForeColor = ColorYellow,
            Font = new Font("Segoe UI", 11F, FontStyle.Bold),
            AutoSize = true,
            Location = new Point(10, 7),
        };
        _statusText = new Label
        {
            Text = "Waiting for viewer to connect…",
            ForeColor = ColorTextSecondary,
            Font = new Font("Segoe UI", 9F, FontStyle.Regular),
            AutoSize = true,
            Location = new Point(28, 9),
        };
        statusCard.Controls.Add(_statusDot);
        statusCard.Controls.Add(_statusText);
        mainLayout.Controls.Add(statusCard, 0, 3);

        // 5. Activity Log
        var logContainer = new Panel
        {
            Dock = DockStyle.Fill,
            Margin = new Padding(0, 0, 0, 8),
            BackColor = ColorSurface,
            Padding = new Padding(1),
        };
        _logBox = new TextBox
        {
            Multiline = true,
            ReadOnly = true,
            Dock = DockStyle.Fill,
            ScrollBars = ScrollBars.Vertical,
            Font = new Font("Consolas", 8.5F),
            BackColor = ColorSurface,
            ForeColor = ColorTextMuted,
            BorderStyle = BorderStyle.None,
            Margin = new Padding(6),
        };
        logContainer.Controls.Add(_logBox);
        mainLayout.Controls.Add(logContainer, 0, 4);

        // 6. Footer note
        var footer = new Label
        {
            Text = "Keep this agent running while managing this PC from Nestcore.",
            ForeColor = ColorTextMuted,
            Font = new Font("Segoe UI", 8F),
            AutoSize = true,
            Margin = new Padding(0, 2, 0, 0),
        };
        mainLayout.Controls.Add(footer, 0, 5);

        Controls.Add(mainLayout);

        // Tray Icon
        _trayIcon = new NotifyIcon
        {
            Icon = SystemIcons.Application,
            Text = "Nestcore Remote Agent (Running)",
            Visible = true,
        };
        var trayMenu = new ContextMenuStrip { BackColor = ColorSurface, ForeColor = ColorTextPrimary };
        trayMenu.Items.Add("Show Agent", null, (_, _) => ShowForm());
        trayMenu.Items.Add(new ToolStripSeparator());
        trayMenu.Items.Add("Exit Agent", null, (_, _) => { _reallyExit = true; Close(); });
        _trayIcon.ContextMenuStrip = trayMenu;
        _trayIcon.DoubleClick += (_, _) => ShowForm();

        // WebSocket Server Events
        _server = new WsServer(cfg);
        _server.ViewerConnected += () => Invoke(() =>
        {
            _statusDot.ForeColor = ColorGreen;
            _statusText.Text = "Viewer connected (Live Streaming)";
            _statusText.ForeColor = ColorGreen;
            AppendLog("Viewer connected — video & audio streaming active");
        });
        _server.ViewerDisconnected += () => Invoke(() =>
        {
            _statusDot.ForeColor = ColorYellow;
            _statusText.Text = "Waiting for viewer to connect…";
            _statusText.ForeColor = ColorTextSecondary;
            AppendLog("Viewer disconnected");
        });
        _server.FileReceived += name => Invoke(() => AppendLog($"Received file: {name}"));
        _server.Start();

        AppendLog($"Agent started on port {cfg.Port} (LAN: {lanIp})");
    }

    private Control CreateLabeledInputRow(string labelText, string value)
    {
        var panel = new Panel
        {
            Dock = DockStyle.Top,
            AutoSize = true,
            Margin = new Padding(0, 0, 0, 10),
            BackColor = Color.Transparent,
        };

        var label = new Label
        {
            Text = labelText,
            ForeColor = ColorTextMuted,
            Font = new Font("Segoe UI", 8.5F, FontStyle.Regular),
            Dock = DockStyle.Top,
            Height = 20,
            Margin = new Padding(0, 0, 0, 2),
        };

        var inputRow = new TableLayoutPanel
        {
            Dock = DockStyle.Top,
            ColumnCount = 2,
            Height = 32,
            BackColor = Color.Transparent,
        };
        inputRow.ColumnStyles.Add(new ColumnStyle(SizeType.Percent, 100));
        inputRow.ColumnStyles.Add(new ColumnStyle(SizeType.AutoSize));

        var textBox = new TextBox
        {
            Text = value,
            ReadOnly = true,
            Dock = DockStyle.Fill,
            Font = new Font("Consolas", 9.5F, FontStyle.Regular),
            BackColor = ColorSurface,
            ForeColor = ColorTextPrimary,
            BorderStyle = BorderStyle.FixedSingle,
        };

        var copyBtn = new Button
        {
            Text = "Copy",
            Font = new Font("Segoe UI", 8.5F, FontStyle.Regular),
            BackColor = ColorButtonBg,
            ForeColor = ColorTextPrimary,
            FlatStyle = FlatStyle.Flat,
            AutoSize = true,
            Height = 30,
            Cursor = Cursors.Hand,
            Margin = new Padding(6, 0, 0, 0),
        };
        copyBtn.FlatAppearance.BorderColor = ColorBorder;
        copyBtn.FlatAppearance.BorderSize = 1;
        copyBtn.FlatAppearance.MouseOverBackColor = ColorButtonHover;

        copyBtn.Click += (_, _) =>
        {
            try
            {
                Clipboard.SetText(value);
                var orig = copyBtn.Text;
                copyBtn.Text = "Copied!";
                copyBtn.ForeColor = ColorGreen;
                var t = new System.Windows.Forms.Timer { Interval = 1500 };
                t.Tick += (_, _) =>
                {
                    copyBtn.Text = orig;
                    copyBtn.ForeColor = ColorTextPrimary;
                    t.Stop();
                    t.Dispose();
                };
                t.Start();
            }
            catch { }
        };

        inputRow.Controls.Add(textBox, 0, 0);
        inputRow.Controls.Add(copyBtn, 1, 0);

        panel.Controls.Add(inputRow);
        panel.Controls.Add(label);
        return panel;
    }

    private void EnableDarkTitleBar()
    {
        try
        {
            int darkMode = 1;
            DwmSetWindowAttribute(Handle, DWMWA_USE_IMMERSIVE_DARK_MODE, ref darkMode, sizeof(int));
        }
        catch { }
    }

    private void ShowForm()
    {
        Show();
        WindowState = FormWindowState.Normal;
        BringToFront();
        Activate();
    }

    protected override void OnFormClosing(FormClosingEventArgs e)
    {
        if (!_reallyExit && e.CloseReason == CloseReason.UserClosing)
        {
            e.Cancel = true;
            Hide();
            _trayIcon.ShowBalloonTip(1500, "Nestcore Remote Agent", "Agent is running in the background.", ToolTipIcon.Info);
            return;
        }
        _trayIcon.Visible = false;
        _trayIcon.Dispose();
        _server.Stop();
        base.OnFormClosing(e);
    }

    private void AppendLog(string line)
    {
        if (IsDisposed || !IsHandleCreated) return;
        _logBox.AppendText($"[{DateTime.Now:HH:mm:ss}] {line}{Environment.NewLine}");
    }
}
