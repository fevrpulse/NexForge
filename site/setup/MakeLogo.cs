using System;
using System.Drawing;
using System.Drawing.Imaging;
using System.Runtime.InteropServices;

class MakeLogo
{
    static void Main()
    {
        var src = new Bitmap(@"C:\Users\fevrp\NexForge\build\icon.png");
        int w = src.Width, h = src.Height;
        var raw = new Bitmap(w, h, PixelFormat.Format32bppArgb);
        using (var g0 = Graphics.FromImage(raw)) g0.DrawImage(src, 0, 0, w, h);
        src.Dispose();

        var data = raw.LockBits(new Rectangle(0, 0, w, h), ImageLockMode.ReadWrite, PixelFormat.Format32bppArgb);
        var bytes = new byte[Math.Abs(data.Stride) * h];
        Marshal.Copy(data.Scan0, bytes, 0, bytes.Length);

        int minX = w, minY = h, maxX = 0, maxY = 0;
        for (int y = 0; y < h; y++)
        {
            int row = y * data.Stride;
            for (int x = 0; x < w; x++)
            {
                int i = row + x * 4;
                int b = bytes[i], g = bytes[i + 1], r = bytes[i + 2];
                int m = r > g ? (r > b ? r : b) : (g > b ? g : b);
                if (m < 22) bytes[i + 3] = 0;
                else if (m < 58) bytes[i + 3] = (byte)((m - 22) * 255 / 36);
                else bytes[i + 3] = 255;
                if (m > 28)
                {
                    if (x < minX) minX = x;
                    if (y < minY) minY = y;
                    if (x > maxX) maxX = x;
                    if (y > maxY) maxY = y;
                }
            }
        }
        Marshal.Copy(bytes, 0, data.Scan0, bytes.Length);
        raw.UnlockBits(data);

        int pad = 6;
        minX = Math.Max(0, minX - pad);
        minY = Math.Max(0, minY - pad);
        maxX = Math.Min(w - 1, maxX + pad);
        maxY = Math.Min(h - 1, maxY + pad);
        var rect = new Rectangle(minX, minY, maxX - minX + 1, maxY - minY + 1);
        var crop = raw.Clone(rect, PixelFormat.Format32bppArgb);
        raw.Dispose();

        var outBmp = new Bitmap(512, 512, PixelFormat.Format32bppArgb);
        using (var g = Graphics.FromImage(outBmp))
        {
            g.Clear(Color.Transparent);
            g.InterpolationMode = System.Drawing.Drawing2D.InterpolationMode.HighQualityBicubic;
            g.PixelOffsetMode = System.Drawing.Drawing2D.PixelOffsetMode.HighQuality;
            g.DrawImage(crop, 0, 0, 512, 512);
        }
        crop.Dispose();
        outBmp.Save(@"C:\Users\fevrp\NexForge\site\logo.png", ImageFormat.Png);
        outBmp.Dispose();
        Console.WriteLine("ok " + rect.Width + "x" + rect.Height);
    }
}
