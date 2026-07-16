using System;
using System.IO;
using System.Linq;
using System.Text;
using System.Text.Json;
using System.Threading;
using System.Threading.Tasks;

namespace HearthstoneAgent.App.Core;

/// <summary>Append-only JSONL writer for one match plus an atomically replaced summary.json.</summary>
public sealed class MatchSessionWriter : IAsyncDisposable
{
    private readonly StreamWriter? _rawWriter;
    private readonly StreamWriter _eventWriter;
    private readonly StreamWriter _snapshotWriter;
    private bool _disposed;

    private MatchSessionWriter(
        string sessionId,
        Guid matchId,
        string matchDirectory,
        bool persistRawLines)
    {
        SessionId = sessionId;
        MatchId = matchId;
        MatchDirectory = matchDirectory;
        Directory.CreateDirectory(matchDirectory);
        if (persistRawLines)
        {
            _rawWriter = CreateWriter(Path.Combine(matchDirectory, "raw-lines.jsonl"));
        }

        _eventWriter = CreateWriter(Path.Combine(matchDirectory, "events.jsonl"));
        _snapshotWriter = CreateWriter(Path.Combine(matchDirectory, "snapshots.jsonl"));
    }

    public string SessionId { get; }
    public Guid MatchId { get; }
    public string MatchDirectory { get; }

    public static MatchSessionWriter Create(
        string dataDirectory,
        string sessionId,
        Guid matchId,
        bool persistRawLines = true)
    {
        ArgumentException.ThrowIfNullOrWhiteSpace(dataDirectory);
        ArgumentException.ThrowIfNullOrWhiteSpace(sessionId);
        if (matchId == Guid.Empty)
        {
            throw new ArgumentException("A match id cannot be empty.", nameof(matchId));
        }

        var safeSessionId = string.Concat(sessionId.Select(character =>
            Path.GetInvalidFileNameChars().Contains(character) ? '_' : character));
        var matchDirectory = Path.Combine(
            Path.GetFullPath(dataDirectory),
            "sessions",
            safeSessionId,
            matchId.ToString("D"));
        return new MatchSessionWriter(sessionId, matchId, matchDirectory, persistRawLines);
    }

    public async ValueTask WriteRawLineAsync(RawLogLine line, CancellationToken cancellationToken = default)
    {
        ThrowIfDisposed();
        if (_rawWriter is null)
        {
            return;
        }

        var persisted = new PersistedRawLine
        {
            SessionId = SessionId,
            MatchId = MatchId,
            SourcePath = line.SourcePath,
            FileGeneration = line.FileGeneration,
            LineNumber = line.LineNumber,
            ByteOffset = line.ByteOffset,
            ObservedAtUtc = line.ObservedAtUtc,
            Content = line.Content
        };
        await WriteJsonLineAsync(_rawWriter, persisted, cancellationToken).ConfigureAwait(false);
    }

    public ValueTask WriteEventAsync(CanonicalGameEvent gameEvent, CancellationToken cancellationToken = default)
    {
        ThrowIfDisposed();
        return WriteJsonLineAsync(_eventWriter, gameEvent, cancellationToken);
    }

    public ValueTask WriteSnapshotAsync(GameStateSnapshot snapshot, CancellationToken cancellationToken = default)
    {
        ThrowIfDisposed();
        return WriteJsonLineAsync(_snapshotWriter, snapshot, cancellationToken);
    }

    public async Task WriteSummaryAsync(MatchSummary summary, CancellationToken cancellationToken = default)
    {
        ThrowIfDisposed();
        var summaryPath = Path.Combine(MatchDirectory, "summary.json");
        var temporaryPath = summaryPath + ".tmp";
        try
        {
            await using (var stream = new FileStream(
                temporaryPath,
                FileMode.Create,
                FileAccess.Write,
                FileShare.None,
                16 * 1024,
                FileOptions.Asynchronous | FileOptions.WriteThrough))
            {
                await JsonSerializer.SerializeAsync(
                    stream,
                    summary,
                    RecorderJson.Options,
                    cancellationToken).ConfigureAwait(false);
                await stream.FlushAsync(cancellationToken).ConfigureAwait(false);
            }

            File.Move(temporaryPath, summaryPath, true);
        }
        finally
        {
            if (File.Exists(temporaryPath))
            {
                File.Delete(temporaryPath);
            }
        }
    }

    public async ValueTask DisposeAsync()
    {
        if (_disposed)
        {
            return;
        }

        _disposed = true;
        if (_rawWriter is not null)
        {
            await _rawWriter.DisposeAsync().ConfigureAwait(false);
        }

        await _eventWriter.DisposeAsync().ConfigureAwait(false);
        await _snapshotWriter.DisposeAsync().ConfigureAwait(false);
    }

    private static StreamWriter CreateWriter(string path)
    {
        var stream = new FileStream(
            path,
            FileMode.Create,
            FileAccess.Write,
            FileShare.Read,
            16 * 1024,
            FileOptions.Asynchronous | FileOptions.SequentialScan);
        return new StreamWriter(stream, new UTF8Encoding(false))
        {
            AutoFlush = true
        };
    }

    private static async ValueTask WriteJsonLineAsync<T>(
        StreamWriter writer,
        T value,
        CancellationToken cancellationToken)
    {
        var json = JsonSerializer.Serialize(value, RecorderJson.JsonLinesOptions);
        await writer.WriteLineAsync(json.AsMemory(), cancellationToken).ConfigureAwait(false);
    }

    private void ThrowIfDisposed() => ObjectDisposedException.ThrowIf(_disposed, this);

    private sealed record PersistedRawLine
    {
        public int SchemaVersion { get; init; } = 1;
        public required string SessionId { get; init; }
        public required Guid MatchId { get; init; }
        public required string SourcePath { get; init; }
        public int FileGeneration { get; init; }
        public long LineNumber { get; init; }
        public long ByteOffset { get; init; }
        public DateTimeOffset ObservedAtUtc { get; init; }
        public required string Content { get; init; }
    }
}
