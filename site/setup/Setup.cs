using System;
using System.ComponentModel;
using System.Diagnostics;
using System.Drawing;
using System.IO;
using System.Net;
using System.Windows.Forms;

namespace NexForgeSetup
{
    static class Program
    {
        [STAThread]
        static void Main()
        {
            ServicePointManager.SecurityProtocol = SecurityProtocolType.Tls12;
            Application.EnableVisualStyles();
            Application.SetCompatibleTextRenderingDefault(false);
            Application.Run(new SetupForm());
        }
    }

    sealed class SetupForm : Form
    {
        const string LatestUrl = "https://github.com/fevrpulse/NexForge/releases/latest/download/NexForge.exe";

        readonly Label status;
        readonly ProgressBar bar;
        readonly WebClient client;
        string dest;

        public SetupForm()
        {
            Text = "NexForge";
            FormBorderStyle = FormBorderStyle.FixedDialog;
            MaximizeBox = false;
            MinimizeBox = false;
            StartPosition = FormStartPosition.CenterScreen;
            ClientSize = new Size(440, 132);
            BackColor = Color.FromArgb(11, 15, 10);
            Font = new Font("Segoe UI", 10f);

            status = new Label();
            status.AutoSize = false;
            status.Bounds = new Rectangle(24, 20, 392, 48);
            status.ForeColor = Color.FromArgb(244, 248, 237);
            status.Text = "Downloading the latest NexForge…";

            bar = new ProgressBar();
            bar.Bounds = new Rectangle(24, 78, 392, 22);
            bar.Style = ProgressBarStyle.Marquee;

            Controls.Add(status);
            Controls.Add(bar);

            dest = Path.Combine(Path.GetTempPath(), "NexForge-Setup.exe");
            client = new WebClient();
            client.Headers.Add("User-Agent", "NexForgeSetup");
            client.DownloadProgressChanged += OnProgress;
            client.DownloadFileCompleted += OnDone;
            Shown += delegate
            {
                try
                {
                    if (File.Exists(dest)) File.Delete(dest);
                }
                catch
                {
                    dest = Path.Combine(Path.GetTempPath(), "NexForge-Setup-" + DateTime.Now.Ticks + ".exe");
                }
                client.DownloadFileAsync(new Uri(LatestUrl), dest);
            };
            FormClosing += delegate
            {
                try { client.CancelAsync(); } catch { }
            };
        }

        void OnProgress(object sender, DownloadProgressChangedEventArgs e)
        {
            if (bar.Style != ProgressBarStyle.Continuous)
            {
                bar.Style = ProgressBarStyle.Continuous;
                bar.Minimum = 0;
                bar.Maximum = 100;
            }
            int pct = e.ProgressPercentage;
            if (pct < 0) pct = 0;
            if (pct > 100) pct = 100;
            bar.Value = pct;
            if (e.TotalBytesToReceive > 0)
                status.Text = "Downloading the latest NexForge… " + pct + "%";
        }

        void OnDone(object sender, AsyncCompletedEventArgs e)
        {
            if (e.Cancelled) return;
            if (e.Error != null)
            {
                MessageBox.Show(this, "Could not download NexForge.\n\n" + e.Error.Message, "NexForge", MessageBoxButtons.OK, MessageBoxIcon.Error);
                Close();
                return;
            }
            try
            {
                using (var fs = File.OpenRead(dest))
                {
                    if (fs.Length < 1024 * 1024)
                        throw new InvalidDataException("The download was incomplete.");
                    int b0 = fs.ReadByte();
                    int b1 = fs.ReadByte();
                    if (b0 != 'M' || b1 != 'Z')
                        throw new InvalidDataException("The download was not the NexForge installer.");
                }
                status.Text = "Starting the installer…";
                Process.Start(new ProcessStartInfo { FileName = dest, UseShellExecute = true });
                Close();
            }
            catch (Exception ex)
            {
                MessageBox.Show(this, ex.Message, "NexForge", MessageBoxButtons.OK, MessageBoxIcon.Error);
                Close();
            }
        }
    }
}
