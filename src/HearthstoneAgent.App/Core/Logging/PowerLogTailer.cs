using System;
using System.Collections.Generic;
using System.IO;
using System.Runtime.CompilerServices;
using System.Text;
using System.Threading;
using System.Threading.Tasks;

namespace HearthstoneAgent.App.Core;

public sealed record PowerLogTailerOptions
{
    public string? ConfiguredPath { get; init; }
    public bool ReadExistingContent { get; init; }
    public TimeSpan PollInterval { get; init; } = TimeSpan.FromMilliseconds(250);
}

public sealed class PowerLogTailerStatusEventArgs(RecorderStatus status) : EventArgs
{
    public RecorderStatus Status { get; } = status;
}

/// <summary>
/// Cancellation-aware byte tailer. It waits for the game to create the log and reopens the file
/// after truncation, replacement, deletion, or a switch to a newer timestamped log directory.
/// </summary>
public sealed class PowerLogTailer
{
    private static readonly Encoding LogEncoding = new UTF8Encoding(false, false);
    private readonly PowerLogLocator _locator;
    private string? _lastStatusSignature;

    public PowerLogTailer(PowerLogLocator? locator = null)
    {
        _locator = locator ?? new PowerLogLocator();
    }

    public event EventHandler<PowerLogTailerStatusEventArgs>? StatusChanged;
    public event EventHandler<RecorderErrorEventArgs>? Error;

    public async IAsyncEnumerable<RawLogLine> ReadLinesAsync(
        PowerLogTailerOptions options,
        [EnumeratorCancellation] CancellationToken cancellationToken = default)
    {
        ArgumentNullException.ThrowIfNull(options);
        _lastStatusSignature = null;
        var pollInterval = options.PollInterval < TimeSpan.FromMilliseconds(50)
            ? TimeSpan.FromMilliseconds(50)
            : options.PollInterval;

        FileStream? stream = null;
        string? activePath = null;
        DateTime activeCreationUtc = default;
        var pending = new List<byte>(512);
        long lineStartOffset = 0;
        long lineNumber = 0;
        var generation = 0;
        var isFirstOpen = true;
        var idlePolls = 0;
        var buffer = new byte[16 * 1024];
        string? resumePath = null;
        DateTime resumeCreationUtc = default;
        long resumeOffset = 0;
        var canResume = false;

        try
        {
            while (!cancellationToken.IsCancellationRequested)
            {
                if (stream is null)
                {
                    var location = _locator.Locate(options.ConfiguredPath);
                    if (!location.Exists)
                    {
                        PublishStatus(RecorderStatusKind.WaitingForLog, "等待 Hearthstone 创建 Power.log。", location.Path);
                        await Task.Delay(pollInterval, cancellationToken).ConfigureAwait(false);
                        continue;
                    }

                    try
                    {
                        stream = OpenShared(location.Path);
                        var openedCreationUtc = File.GetCreationTimeUtc(location.Path);
                        var startOffset = isFirstOpen && !options.ReadExistingContent
                            ? stream.Length
                            : 0;
                        if (!isFirstOpen && canResume && resumePath is not null &&
                            PathEquals(location.Path, resumePath) &&
                            openedCreationUtc == resumeCreationUtc &&
                            stream.Length >= resumeOffset)
                        {
                            startOffset = resumeOffset;
                        }

                        activePath = location.Path;
                        activeCreationUtc = openedCreationUtc;
                        generation++;
                        lineNumber = 0;
                        pending.Clear();
                        stream.Position = startOffset;
                        isFirstOpen = false;
                        canResume = false;
                        lineStartOffset = stream.Position;
                        idlePolls = 0;
                        PublishStatus(RecorderStatusKind.Reading, "正在读取 Power.log。", activePath);
                    }
                    catch (Exception exception) when (exception is IOException or UnauthorizedAccessException)
                    {
                        PublishError(exception, "打开 Power.log", true);
                        stream?.Dispose();
                        stream = null;
                        await Task.Delay(pollInterval, cancellationToken).ConfigureAwait(false);
                        continue;
                    }
                }

                int bytesRead;
                try
                {
                    bytesRead = await stream.ReadAsync(buffer, cancellationToken).ConfigureAwait(false);
                }
                catch (Exception exception) when (exception is IOException or UnauthorizedAccessException)
                {
                    PublishError(exception, "读取 Power.log", true);
                    resumePath = activePath;
                    resumeCreationUtc = activeCreationUtc;
                    resumeOffset = lineStartOffset;
                    canResume = true;
                    stream.Dispose();
                    stream = null;
                    pending.Clear();
                    continue;
                }

                if (bytesRead > 0)
                {
                    idlePolls = 0;
                    var readStartOffset = stream.Position - bytesRead;
                    for (var index = 0; index < bytesRead; index++)
                    {
                        var current = buffer[index];
                        if (current != (byte)'\n')
                        {
                            pending.Add(current);
                            continue;
                        }

                        if (pending.Count > 0 && pending[^1] == (byte)'\r')
                        {
                            pending.RemoveAt(pending.Count - 1);
                        }

                        lineNumber++;
                        var content = DecodeLine(pending, lineNumber);
                        pending.Clear();
                        yield return new RawLogLine(
                            activePath!,
                            generation,
                            lineNumber,
                            lineStartOffset,
                            DateTimeOffset.UtcNow,
                            content);
                        lineStartOffset = readStartOffset + index + 1;
                    }

                    continue;
                }

                idlePolls++;
                if (ShouldReopen(activePath!, activeCreationUtc, stream.Position))
                {
                    canResume = false;
                    stream.Dispose();
                    stream = null;
                    pending.Clear();
                    continue;
                }

                // Timestamped Hearthstone log folders can leave the old file in place. Periodically
                // ask the locator whether a newer candidate has become active.
                if (idlePolls >= 8 && string.IsNullOrWhiteSpace(options.ConfiguredPath))
                {
                    idlePolls = 0;
                    var newest = _locator.Locate();
                    if (newest.Exists && !PathEquals(newest.Path, activePath!))
                    {
                        canResume = false;
                        stream.Dispose();
                        stream = null;
                        pending.Clear();
                        continue;
                    }
                }

                await Task.Delay(pollInterval, cancellationToken).ConfigureAwait(false);
            }
        }
        finally
        {
            stream?.Dispose();
        }
    }

    private static FileStream OpenShared(string path) => new(
        path,
        FileMode.Open,
        FileAccess.Read,
        FileShare.ReadWrite | FileShare.Delete,
        16 * 1024,
        FileOptions.Asynchronous | FileOptions.SequentialScan);

    private static bool ShouldReopen(string path, DateTime creationUtc, long position)
    {
        try
        {
            if (!File.Exists(path))
            {
                return true;
            }

            var information = new FileInfo(path);
            return information.Length < position || information.CreationTimeUtc != creationUtc;
        }
        catch (IOException)
        {
            return true;
        }
        catch (UnauthorizedAccessException)
        {
            return true;
        }
    }

    private static string DecodeLine(List<byte> bytes, long lineNumber)
    {
        if (bytes.Count == 0)
        {
            return string.Empty;
        }

        var line = LogEncoding.GetString(bytes.ToArray());
        return lineNumber == 1 ? line.TrimStart('\uFEFF') : line;
    }

    private static bool PathEquals(string left, string right) =>
        string.Equals(Path.GetFullPath(left), Path.GetFullPath(right), StringComparison.OrdinalIgnoreCase);

    private void PublishStatus(RecorderStatusKind kind, string message, string? path)
    {
        var signature = $"{kind}|{path}";
        if (signature == _lastStatusSignature)
        {
            return;
        }

        _lastStatusSignature = signature;
        StatusChanged?.Invoke(
            this,
            new PowerLogTailerStatusEventArgs(new RecorderStatus(kind, message, DateTimeOffset.UtcNow, path)));
    }

    private void PublishError(Exception exception, string context, bool recoverable) =>
        Error?.Invoke(this, new RecorderErrorEventArgs(exception, context, recoverable));
}
