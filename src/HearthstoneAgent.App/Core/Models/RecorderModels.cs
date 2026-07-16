using System;
using System.Collections.Generic;
using System.Collections.ObjectModel;

namespace HearthstoneAgent.App.Core;

/// <summary>
/// Canonical event kinds understood by the first recorder version.
/// Names deliberately mirror Power.log where possible to make exported data easy to inspect.
/// </summary>
public enum GameEventType
{
    Unknown,
    CreateGame,
    FullEntity,
    ShowEntity,
    HideEntity,
    ChangeEntity,
    TagChange,
    BlockStart,
    BlockEnd,
    ChoicesStart,
    Choice,
    ChoicesEnd,
    OptionsStart,
    Option,
    OptionsEnd,
    SendOption
}

public enum RecorderStatusKind
{
    Stopped,
    Starting,
    WaitingForLog,
    Reading,
    Stopping,
    Faulted
}

/// <summary>A line read from Power.log, including its source position for later diagnosis.</summary>
public sealed record RawLogLine(
    string SourcePath,
    int FileGeneration,
    long LineNumber,
    long ByteOffset,
    DateTimeOffset ObservedAtUtc,
    string Content);

/// <summary>
/// Stable application event produced from a Power.log line. Extra parser fields live in Data so
/// future game fields do not require breaking the v0.1 format.
/// </summary>
public sealed record CanonicalGameEvent
{
    public int SchemaVersion { get; init; } = 1;
    public Guid MatchId { get; init; }
    public long Sequence { get; init; }
    public DateTimeOffset ObservedAtUtc { get; init; }
    public GameEventType Type { get; init; }
    public int? EntityId { get; init; }
    public string? CardId { get; init; }
    public int? PlayerId { get; init; }
    public string? Tag { get; init; }
    public string? Value { get; init; }
    public long RawLineNumber { get; init; }
    public long RawByteOffset { get; init; }
    public IReadOnlyDictionary<string, string> Data { get; init; }
        = EmptyReadOnlyDictionary<string, string>.Instance;
}

/// <summary>A serializable snapshot of one entity at a point in the event stream.</summary>
public sealed record GameEntitySnapshot
{
    public int EntityId { get; init; }
    public string? CardId { get; init; }
    public string? Name { get; init; }
    public int? PlayerId { get; init; }
    public int? ControllerId { get; init; }
    public string? Zone { get; init; }
    public int? ZonePosition { get; init; }
    public bool IsVisible { get; init; }
    public IReadOnlyDictionary<string, string> Tags { get; init; }
        = EmptyReadOnlyDictionary<string, string>.Instance;
}

/// <summary>Immutable UI/persistence view of the state reducer.</summary>
public sealed record GameStateSnapshot
{
    public int SchemaVersion { get; init; } = 1;
    public Guid MatchId { get; init; }
    public long Version { get; init; }
    public DateTimeOffset CapturedAtUtc { get; init; }
    public DateTimeOffset StartedAtUtc { get; init; }
    public DateTimeOffset? EndedAtUtc { get; init; }
    public int Turn { get; init; }
    public string? Step { get; init; }
    public int? CurrentPlayerId { get; init; }
    public int? FriendlyPlayerId { get; init; }
    public int? WinnerPlayerId { get; init; }
    public string? Outcome { get; init; }
    public bool IsComplete { get; init; }
    public int BlockDepth { get; init; }
    public bool IsChoosing { get; init; }
    public bool HasOptions { get; init; }
    public long ActionCount { get; init; }
    public IReadOnlyDictionary<int, GameEntitySnapshot> Entities { get; init; }
        = EmptyReadOnlyDictionary<int, GameEntitySnapshot>.Instance;
    public IReadOnlyDictionary<int, IReadOnlyList<string>> PlayedCardsByPlayer { get; init; }
        = EmptyReadOnlyDictionary<int, IReadOnlyList<string>>.Instance;
}

/// <summary>Small, durable end-of-match record written to summary.json.</summary>
public sealed record MatchSummary
{
    public int SchemaVersion { get; init; } = 1;
    public required string SessionId { get; init; }
    public required Guid MatchId { get; init; }
    public required DateTimeOffset StartedAtUtc { get; init; }
    public DateTimeOffset? EndedAtUtc { get; init; }
    public double? DurationSeconds { get; init; }
    public int TurnCount { get; init; }
    public long EventCount { get; init; }
    public int EntityCount { get; init; }
    public int? FriendlyPlayerId { get; init; }
    public int? WinnerPlayerId { get; init; }
    public string? Outcome { get; init; }
    public bool IsComplete { get; init; }
    public required string CompletionReason { get; init; }
    public IReadOnlyDictionary<int, IReadOnlyList<string>> PlayedCardsByPlayer { get; init; }
        = EmptyReadOnlyDictionary<int, IReadOnlyList<string>>.Instance;
}

public sealed record RecorderStatus(
    RecorderStatusKind Kind,
    string Message,
    DateTimeOffset ChangedAtUtc,
    string? LogPath = null);

public sealed class RecorderStatusChangedEventArgs(RecorderStatus status) : EventArgs
{
    public RecorderStatus Status { get; } = status;
}

public sealed class GameEventReceivedEventArgs(CanonicalGameEvent gameEvent) : EventArgs
{
    public CanonicalGameEvent GameEvent { get; } = gameEvent;
}

public sealed class GameStateSnapshotEventArgs(GameStateSnapshot snapshot, bool persisted) : EventArgs
{
    public GameStateSnapshot Snapshot { get; } = snapshot;
    public bool Persisted { get; } = persisted;
}

public sealed class MatchCompletedEventArgs(MatchSummary summary, string matchDirectory) : EventArgs
{
    public MatchSummary Summary { get; } = summary;
    public string MatchDirectory { get; } = matchDirectory;
}

public sealed class RecorderErrorEventArgs(Exception exception, string context, bool isRecoverable) : EventArgs
{
    public Exception Exception { get; } = exception;
    public string Context { get; } = context;
    public bool IsRecoverable { get; } = isRecoverable;
}

internal static class EmptyReadOnlyDictionary<TKey, TValue> where TKey : notnull
{
    public static readonly IReadOnlyDictionary<TKey, TValue> Instance =
        new ReadOnlyDictionary<TKey, TValue>(new Dictionary<TKey, TValue>());
}
