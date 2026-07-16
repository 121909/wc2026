using System;
using System.IO;
using System.Linq;
using System.Globalization;
using System.Threading;
using System.Threading.Tasks;

namespace HearthstoneAgent.App.Core;

/// <summary>
/// High-level passive recorder used by the WPF layer. Events are raised on the recorder's
/// background thread; a ViewModel should marshal property changes through its Dispatcher.
/// </summary>
public sealed class RecorderService : IAsyncDisposable
{
    private readonly SemaphoreSlim _lifecycleGate = new(1, 1);
    private readonly object _disposeSync = new();
    private readonly AppSettings _settings;
    private readonly PowerLogTailer _tailer;
    private readonly PowerLogParser _parser;
    private readonly GameStateReducer _reducer;
    private CancellationTokenSource? _runCancellation;
    private Task? _runTask;
    private MatchSessionWriter? _matchWriter;
    private RecorderStatus _status = new(
        RecorderStatusKind.Stopped,
        "记录器未运行。",
        DateTimeOffset.UtcNow);
    private GameStateSnapshot? _currentSnapshot;
    private string? _lastMatchDirectory;
    private long _eventSequence;
    private long _lastPersistedSnapshotVersion;
    private int _isRunning;
    private bool _disposed;
    private Task? _disposeTask;

    public RecorderService(
        AppSettings? settings = null,
        PowerLogLocator? locator = null,
        PowerLogParser? parser = null,
        GameStateReducer? reducer = null)
    {
        _settings = (settings ?? new AppSettings()).Normalize();
        _tailer = new PowerLogTailer(locator);
        _parser = parser ?? new PowerLogParser();
        _reducer = reducer ?? new GameStateReducer();
        SessionId = CreateSessionId();
        _tailer.StatusChanged += HandleTailerStatusChanged;
        _tailer.Error += HandleTailerError;
    }

    public event EventHandler<RecorderStatusChangedEventArgs>? StatusChanged;
    public event EventHandler<GameEventReceivedEventArgs>? EventReceived;
    public event EventHandler<GameStateSnapshotEventArgs>? SnapshotUpdated;
    public event EventHandler<MatchCompletedEventArgs>? MatchCompleted;
    public event EventHandler<RecorderErrorEventArgs>? Error;

    public AppSettings Settings => _settings;
    public string SessionId { get; }
    public bool IsRunning => Volatile.Read(ref _isRunning) == 1;
    public RecorderStatus Status => Volatile.Read(ref _status);
    public GameStateSnapshot? CurrentSnapshot => Volatile.Read(ref _currentSnapshot);
    public string? LastMatchDirectory => Volatile.Read(ref _lastMatchDirectory);

    /// <summary>Loads settings.json and creates a service with those settings.</summary>
    public static async Task<RecorderService> CreateFromSettingsAsync(
        JsonSettingsStore? settingsStore = null,
        CancellationToken cancellationToken = default)
    {
        var store = settingsStore ?? new JsonSettingsStore();
        var settings = await store.LoadAsync(cancellationToken).ConfigureAwait(false);
        return new RecorderService(settings);
    }

    /// <summary>Starts the background reader and returns after startup has been scheduled.</summary>
    public async Task StartAsync(CancellationToken cancellationToken = default)
    {
        ObjectDisposedException.ThrowIf(_disposed, this);
        await _lifecycleGate.WaitAsync(cancellationToken).ConfigureAwait(false);
        try
        {
            ObjectDisposedException.ThrowIf(_disposed, this);
            if (IsRunning)
            {
                return;
            }

            if (_runTask is { IsCompleted: true })
            {
                _runCancellation?.Dispose();
                _runCancellation = null;
                _runTask = null;
            }

            Directory.CreateDirectory(_settings.DataDirectory);
            _runCancellation = CancellationTokenSource.CreateLinkedTokenSource(cancellationToken);
            Interlocked.Exchange(ref _isRunning, 1);
            SetStatus(new RecorderStatus(
                RecorderStatusKind.Starting,
                "正在启动被动对局记录器。",
                DateTimeOffset.UtcNow,
                _settings.PowerLogPath));
            _runTask = Task.Run(() => RunAsync(_runCancellation.Token), CancellationToken.None);
        }
        finally
        {
            _lifecycleGate.Release();
        }
    }

    /// <summary>Cancels log reading, saves a partial summary if needed, and waits for all files to close.</summary>
    public async Task StopAsync(CancellationToken cancellationToken = default)
    {
        Task? taskToWait;
        await _lifecycleGate.WaitAsync(cancellationToken).ConfigureAwait(false);
        try
        {
            taskToWait = _runTask;
            if (!IsRunning && taskToWait is null)
            {
                return;
            }

            if (IsRunning)
            {
                SetStatus(new RecorderStatus(
                    RecorderStatusKind.Stopping,
                    "正在保存并停止记录器。",
                    DateTimeOffset.UtcNow,
                    Status.LogPath));
                _runCancellation?.Cancel();
            }
        }
        finally
        {
            _lifecycleGate.Release();
        }

        if (taskToWait is not null)
        {
            await taskToWait.WaitAsync(cancellationToken).ConfigureAwait(false);
        }

        if (Status.Kind == RecorderStatusKind.Faulted)
        {
            throw new InvalidOperationException(Status.Message);
        }
    }

    public ValueTask DisposeAsync()
    {
        lock (_disposeSync)
        {
            if (_disposeTask is null)
            {
                _disposed = true;
                _disposeTask = DisposeCoreAsync();
            }

            return new ValueTask(_disposeTask);
        }
    }

    private async Task DisposeCoreAsync()
    {
        try
        {
            await StopAsync().ConfigureAwait(false);
        }
        finally
        {
            _tailer.StatusChanged -= HandleTailerStatusChanged;
            _tailer.Error -= HandleTailerError;
            _runCancellation?.Dispose();
            _lifecycleGate.Dispose();
        }
    }

    private async Task RunAsync(CancellationToken cancellationToken)
    {
        var faulted = false;
        var completionReason = "RecorderStopped";
        try
        {
            var options = new PowerLogTailerOptions
            {
                ConfiguredPath = _settings.PowerLogPath,
                ReadExistingContent = _settings.ReadExistingLogOnStart,
                PollInterval = TimeSpan.FromMilliseconds(_settings.PollIntervalMilliseconds)
            };

            await foreach (var line in _tailer.ReadLinesAsync(options, cancellationToken).ConfigureAwait(false))
            {
                await ProcessLineAsync(line, cancellationToken).ConfigureAwait(false);
            }
        }
        catch (OperationCanceledException) when (cancellationToken.IsCancellationRequested)
        {
            // Normal StopAsync path.
        }
        catch (Exception exception)
        {
            faulted = true;
            completionReason = "RecorderFaulted";
            PublishError(exception, "记录器后台循环", false);
            SetStatus(new RecorderStatus(
                RecorderStatusKind.Faulted,
                $"记录器已停止：{exception.Message}",
                DateTimeOffset.UtcNow,
                Status.LogPath));
        }
        finally
        {
            try
            {
                await FinalizeActiveMatchAsync(completionReason).ConfigureAwait(false);
            }
            catch (Exception exception)
            {
                faulted = true;
                PublishError(exception, "保存最后一场对局", false);
                SetStatus(new RecorderStatus(
                    RecorderStatusKind.Faulted,
                    $"最后一场对局未能完整保存：{exception.Message}",
                    DateTimeOffset.UtcNow,
                    Status.LogPath));
            }

            Interlocked.Exchange(ref _isRunning, 0);
            if (!faulted)
            {
                SetStatus(new RecorderStatus(
                    RecorderStatusKind.Stopped,
                    "记录器已停止。",
                    DateTimeOffset.UtcNow,
                    Status.LogPath));
            }
        }
    }

    private async Task ProcessLineAsync(RawLogLine line, CancellationToken cancellationToken)
    {
        var parsedEvents = _parser.Parse(line);
        if (parsedEvents.Any(gameEvent => gameEvent.Type == GameEventType.CreateGame))
        {
            await FinalizeActiveMatchAsync("NewGameDetected").ConfigureAwait(false);
            StartNewMatch(line.ObservedAtUtc);
        }

        if (_matchWriter is not null)
        {
            await _matchWriter.WriteRawLineAsync(line, cancellationToken).ConfigureAwait(false);
        }

        foreach (var parsedEvent in parsedEvents)
        {
            if (_matchWriter is null || !_reducer.HasMatch)
            {
                continue;
            }

            var gameEvent = parsedEvent with
            {
                MatchId = _reducer.MatchId,
                Sequence = ++_eventSequence
            };
            await _matchWriter.WriteEventAsync(gameEvent, cancellationToken).ConfigureAwait(false);
            var snapshot = _reducer.Apply(gameEvent);
            Volatile.Write(ref _currentSnapshot, snapshot);
            Raise(EventReceived, new GameEventReceivedEventArgs(gameEvent));

            var persistSnapshot = ShouldPersistSnapshot(gameEvent, snapshot);
            if (persistSnapshot)
            {
                await _matchWriter.WriteSnapshotAsync(snapshot, cancellationToken).ConfigureAwait(false);
                _lastPersistedSnapshotVersion = snapshot.Version;
            }

            Raise(SnapshotUpdated, new GameStateSnapshotEventArgs(snapshot, persistSnapshot));
            if (snapshot.IsComplete)
            {
                await FinalizeActiveMatchAsync("GameCompleted").ConfigureAwait(false);
            }
        }
    }

    private void StartNewMatch(DateTimeOffset startedAtUtc)
    {
        var matchId = Guid.NewGuid();
        _eventSequence = 0;
        _lastPersistedSnapshotVersion = 0;
        _reducer.StartMatch(matchId, startedAtUtc);
        _matchWriter = MatchSessionWriter.Create(
            _settings.DataDirectory,
            SessionId,
            matchId,
            _settings.PersistRawLines);
        Volatile.Write(ref _lastMatchDirectory, _matchWriter.MatchDirectory);
    }

    private async Task FinalizeActiveMatchAsync(string reason)
    {
        var writer = _matchWriter;
        if (writer is null || !_reducer.HasMatch)
        {
            return;
        }

        _matchWriter = null;
        var snapshot = CurrentSnapshot;
        var summary = _reducer.CreateSummary(SessionId, reason);
        // Once a writer is detached from the live pipeline, finishing its snapshot and summary is
        // a durability operation. A Stop cancellation must not leave a half-closed match folder.
        var persistenceCancellationToken = CancellationToken.None;
        Exception? persistenceError = null;
        try
        {
            if (snapshot is not null &&
                snapshot.MatchId == writer.MatchId &&
                snapshot.Version > _lastPersistedSnapshotVersion)
            {
                await writer.WriteSnapshotAsync(snapshot, persistenceCancellationToken).ConfigureAwait(false);
                _lastPersistedSnapshotVersion = snapshot.Version;
            }

            await writer.WriteSummaryAsync(summary, persistenceCancellationToken).ConfigureAwait(false);
        }
        catch (Exception exception)
        {
            persistenceError = exception;
        }
        finally
        {
            await writer.DisposeAsync().ConfigureAwait(false);
        }

        if (persistenceError is not null)
        {
            throw new IOException("无法完整保存对局记录。", persistenceError);
        }

        Raise(MatchCompleted, new MatchCompletedEventArgs(summary, writer.MatchDirectory));
    }

    private bool ShouldPersistSnapshot(CanonicalGameEvent gameEvent, GameStateSnapshot snapshot)
    {
        if (snapshot.IsComplete || gameEvent.Type is
            GameEventType.CreateGame or
            GameEventType.ChoicesStart or
            GameEventType.ChoicesEnd or
            GameEventType.OptionsStart or
            GameEventType.OptionsEnd or
            GameEventType.SendOption)
        {
            return true;
        }

        if (gameEvent.Type == GameEventType.TagChange && gameEvent.Tag is not null &&
            (gameEvent.Tag.Equals("TURN", StringComparison.OrdinalIgnoreCase) ||
             gameEvent.Tag.Equals("STEP", StringComparison.OrdinalIgnoreCase) ||
             gameEvent.Tag.Equals("PLAYSTATE", StringComparison.OrdinalIgnoreCase)))
        {
            return true;
        }

        return snapshot.Version % _settings.SnapshotEveryEvents == 0;
    }

    private void HandleTailerStatusChanged(object? sender, PowerLogTailerStatusEventArgs eventArgs) =>
        SetStatus(eventArgs.Status);

    private void HandleTailerError(object? sender, RecorderErrorEventArgs eventArgs) =>
        Raise(Error, eventArgs);

    private void SetStatus(RecorderStatus status)
    {
        Volatile.Write(ref _status, status);
        Raise(StatusChanged, new RecorderStatusChangedEventArgs(status));
    }

    private void PublishError(Exception exception, string context, bool recoverable) =>
        Raise(Error, new RecorderErrorEventArgs(exception, context, recoverable));

    private void Raise<TEventArgs>(EventHandler<TEventArgs>? handlers, TEventArgs eventArgs)
        where TEventArgs : EventArgs
    {
        if (handlers is null)
        {
            return;
        }

        foreach (EventHandler<TEventArgs> handler in handlers.GetInvocationList())
        {
            try
            {
                handler(this, eventArgs);
            }
            catch
            {
                // A UI subscriber must not stop log capture. The subscriber owns its exception.
            }
        }
    }

    private static string CreateSessionId()
    {
        var timestamp = DateTimeOffset.UtcNow.ToString(
            "yyyyMMdd'T'HHmmssfff'Z'",
            CultureInfo.InvariantCulture);
        var guidPrefix = Guid.NewGuid().ToString("N", CultureInfo.InvariantCulture)[..8];
        return $"{timestamp}_{guidPrefix}";
    }
}
