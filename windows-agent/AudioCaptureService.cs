using NAudio.Wave;

namespace RemoteAgent;

// Captures whatever's playing on the default output device (WASAPI loopback)
// and resamples it to a fixed 48kHz/16-bit/stereo PCM stream so the Android
// app doesn't need to negotiate formats — only started while a viewer has
// asked for audio, since it costs real CPU/bandwidth otherwise.
internal sealed class AudioCaptureService : IDisposable
{
    public static readonly WaveFormat TargetFormat = new(48000, 16, 2);

    WasapiLoopbackCapture? _capture;
    MediaFoundationResampler? _resampler;
    BufferedWaveProvider? _buffer;
    Thread? _pumpThread;
    volatile bool _running;

    public event Action<byte[]>? AudioAvailable;

    public void Start()
    {
        if (_capture is not null) return;

        _capture = new WasapiLoopbackCapture();
        _buffer = new BufferedWaveProvider(_capture.WaveFormat)
        {
            DiscardOnBufferOverflow = true,
            BufferDuration = TimeSpan.FromSeconds(2),
        };
        _capture.DataAvailable += (_, e) => _buffer.AddSamples(e.Buffer, 0, e.BytesRecorded);
        _resampler = new MediaFoundationResampler(_buffer, TargetFormat) { ResamplerQuality = 30 };

        _running = true;
        _capture.StartRecording();
        _pumpThread = new Thread(PumpLoop) { IsBackground = true };
        _pumpThread.Start();
    }

    void PumpLoop()
    {
        var chunkBytes = TargetFormat.AverageBytesPerSecond / 10; // ~100ms per chunk
        var buf = new byte[chunkBytes];
        while (_running && _resampler is not null)
        {
            int read;
            try { read = _resampler.Read(buf, 0, buf.Length); }
            catch { break; }

            if (read > 0)
            {
                var chunk = new byte[read];
                Array.Copy(buf, chunk, read);
                AudioAvailable?.Invoke(chunk);
            }
            else
            {
                Thread.Sleep(20);
            }
        }
    }

    public void Stop()
    {
        _running = false;
        try { _capture?.StopRecording(); } catch { /* already stopped */ }
        _pumpThread?.Join(500);
        _resampler?.Dispose();
        _capture?.Dispose();
        _resampler = null;
        _capture = null;
        _buffer = null;
    }

    public void Dispose() => Stop();
}
