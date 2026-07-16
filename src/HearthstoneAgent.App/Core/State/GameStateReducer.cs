using System;
using System.Collections.Generic;
using System.Collections.ObjectModel;
using System.Globalization;
using System.Linq;

namespace HearthstoneAgent.App.Core;

/// <summary>
/// Deterministically folds canonical events into game state. Hidden opponent information is never
/// guessed: an entity remains unknown until Power.log reveals its card id.
/// </summary>
public sealed class GameStateReducer
{
    private readonly Dictionary<int, MutableEntity> _entities = [];
    private readonly Dictionary<int, string> _playStates = [];
    private readonly Dictionary<int, List<string>> _playedCards = [];
    private readonly Dictionary<int, List<int?>> _pendingPlayedCards = [];
    private Guid _matchId;
    private DateTimeOffset _startedAtUtc;
    private DateTimeOffset? _endedAtUtc;
    private DateTimeOffset _lastEventAtUtc;
    private long _version;
    private int _turn;
    private string? _step;
    private int? _currentPlayerId;
    private int? _friendlyPlayerId;
    private int? _winnerPlayerId;
    private int _blockDepth;
    private bool _isChoosing;
    private bool _hasOptions;
    private long _actionCount;
    private bool _isComplete;

    public bool HasMatch => _matchId != Guid.Empty;
    public bool IsComplete => _isComplete;
    public Guid MatchId => _matchId;

    public void StartMatch(Guid matchId, DateTimeOffset startedAtUtc)
    {
        if (matchId == Guid.Empty)
        {
            throw new ArgumentException("A match id cannot be empty.", nameof(matchId));
        }

        _entities.Clear();
        _playStates.Clear();
        _playedCards.Clear();
        _pendingPlayedCards.Clear();
        _matchId = matchId;
        _startedAtUtc = startedAtUtc;
        _lastEventAtUtc = startedAtUtc;
        _endedAtUtc = null;
        _version = 0;
        _turn = 0;
        _step = null;
        _currentPlayerId = null;
        _friendlyPlayerId = null;
        _winnerPlayerId = null;
        _blockDepth = 0;
        _isChoosing = false;
        _hasOptions = false;
        _actionCount = 0;
        _isComplete = false;
    }

    public GameStateSnapshot Apply(CanonicalGameEvent gameEvent)
    {
        ArgumentNullException.ThrowIfNull(gameEvent);
        if (!HasMatch)
        {
            throw new InvalidOperationException("StartMatch must be called before applying events.");
        }

        _version = Math.Max(_version + 1, gameEvent.Sequence);
        _lastEventAtUtc = gameEvent.ObservedAtUtc;

        switch (gameEvent.Type)
        {
            case GameEventType.FullEntity:
            case GameEventType.ShowEntity:
            case GameEventType.ChangeEntity:
                ApplyEntity(gameEvent);
                break;
            case GameEventType.HideEntity:
                ApplyHiddenEntity(gameEvent);
                break;
            case GameEventType.TagChange:
                ApplyTag(gameEvent);
                break;
            case GameEventType.BlockStart:
                _blockDepth++;
                RecordPlayedCard(gameEvent);
                break;
            case GameEventType.BlockEnd:
                _blockDepth = Math.Max(0, _blockDepth - 1);
                break;
            case GameEventType.ChoicesStart:
                _isChoosing = true;
                break;
            case GameEventType.ChoicesEnd:
                _isChoosing = false;
                break;
            case GameEventType.OptionsStart:
                _hasOptions = true;
                break;
            case GameEventType.OptionsEnd:
                _hasOptions = false;
                break;
            case GameEventType.SendOption:
                _actionCount++;
                break;
        }

        UpdateCompletion(gameEvent.ObservedAtUtc);
        return CreateSnapshot(gameEvent.ObservedAtUtc);
    }

    public GameStateSnapshot CreateSnapshot(DateTimeOffset? capturedAtUtc = null)
    {
        if (!HasMatch)
        {
            throw new InvalidOperationException("There is no active match.");
        }

        var entityCopies = new SortedDictionary<int, GameEntitySnapshot>();
        foreach (var (id, entity) in _entities)
        {
            entityCopies[id] = new GameEntitySnapshot
            {
                EntityId = id,
                CardId = entity.CardId,
                Name = entity.Name,
                PlayerId = entity.PlayerId,
                ControllerId = entity.ControllerId,
                Zone = entity.Zone,
                ZonePosition = entity.ZonePosition,
                IsVisible = entity.IsVisible,
                Tags = new ReadOnlyDictionary<string, string>(
                    new SortedDictionary<string, string>(entity.Tags, StringComparer.Ordinal))
            };
        }

        return new GameStateSnapshot
        {
            MatchId = _matchId,
            Version = _version,
            CapturedAtUtc = capturedAtUtc ?? _lastEventAtUtc,
            StartedAtUtc = _startedAtUtc,
            EndedAtUtc = _endedAtUtc,
            Turn = _turn,
            Step = _step,
            CurrentPlayerId = _currentPlayerId,
            FriendlyPlayerId = _friendlyPlayerId,
            WinnerPlayerId = _winnerPlayerId,
            Outcome = GetOutcome(),
            IsComplete = _isComplete,
            BlockDepth = _blockDepth,
            IsChoosing = _isChoosing,
            HasOptions = _hasOptions,
            ActionCount = _actionCount,
            Entities = new ReadOnlyDictionary<int, GameEntitySnapshot>(entityCopies),
            PlayedCardsByPlayer = CopyPlayedCards()
        };
    }

    public MatchSummary CreateSummary(string sessionId, string completionReason)
    {
        if (!HasMatch)
        {
            throw new InvalidOperationException("There is no active match.");
        }

        var duration = _endedAtUtc.HasValue
            ? Math.Max(0, (_endedAtUtc.Value - _startedAtUtc).TotalSeconds)
            : (double?)null;
        return new MatchSummary
        {
            SessionId = sessionId,
            MatchId = _matchId,
            StartedAtUtc = _startedAtUtc,
            EndedAtUtc = _endedAtUtc,
            DurationSeconds = duration,
            TurnCount = _turn,
            EventCount = _version,
            EntityCount = _entities.Count,
            FriendlyPlayerId = _friendlyPlayerId,
            WinnerPlayerId = _winnerPlayerId,
            Outcome = GetOutcome(),
            IsComplete = _isComplete,
            CompletionReason = completionReason,
            PlayedCardsByPlayer = CopyPlayedCards()
        };
    }

    private void ApplyEntity(CanonicalGameEvent gameEvent)
    {
        if (!gameEvent.EntityId.HasValue)
        {
            return;
        }

        var entity = GetOrCreate(gameEvent.EntityId.Value);
        if (!string.IsNullOrWhiteSpace(gameEvent.CardId))
        {
            entity.CardId = gameEvent.CardId;
        }

        if (gameEvent.PlayerId.HasValue)
        {
            entity.PlayerId = gameEvent.PlayerId;
        }

        if (gameEvent.Data.TryGetValue("name", out var name))
        {
            entity.Name = name;
        }

        if (gameEvent.Data.TryGetValue("zone", out var zone))
        {
            entity.Zone = zone;
        }

        if (gameEvent.Data.TryGetValue("zonePosition", out var position) && TryInt(position, out var zonePosition))
        {
            entity.ZonePosition = zonePosition;
        }

        entity.IsVisible = gameEvent.Type != GameEventType.FullEntity || !string.IsNullOrWhiteSpace(entity.CardId);
        ResolvePendingPlayedCards(entity);
    }

    private void ApplyHiddenEntity(CanonicalGameEvent gameEvent)
    {
        if (gameEvent.EntityId.HasValue)
        {
            GetOrCreate(gameEvent.EntityId.Value).IsVisible = false;
        }
    }

    private void ApplyTag(CanonicalGameEvent gameEvent)
    {
        if (string.IsNullOrWhiteSpace(gameEvent.Tag))
        {
            return;
        }

        var tag = gameEvent.Tag.ToUpperInvariant();
        var value = gameEvent.Value ?? string.Empty;

        // GameEntity is written literally in some client builds, so these match-wide tags may not
        // carry a numeric entity id and must be reduced before entity-specific handling.
        switch (tag)
        {
            case "TURN":
                if (TryInt(value, out var turn))
                {
                    _turn = Math.Max(_turn, turn);
                }
                break;
            case "STEP":
                _step = value;
                break;
            case "FRIENDLY_PLAYER":
                if (TryInt(value, out var friendlyPlayer))
                {
                    _friendlyPlayerId = friendlyPlayer;
                }
                break;
        }

        if (!gameEvent.EntityId.HasValue)
        {
            return;
        }

        var entity = GetOrCreate(gameEvent.EntityId.Value);
        entity.Tags[tag] = value;

        switch (tag)
        {
            case "ZONE":
                entity.Zone = value;
                break;
            case "ZONE_POSITION":
                if (TryInt(value, out var zonePosition))
                {
                    entity.ZonePosition = zonePosition;
                }
                break;
            case "CONTROLLER":
                if (TryInt(value, out var controller))
                {
                    entity.ControllerId = controller;
                }
                break;
            case "PLAYER_ID":
                if (TryInt(value, out var playerId))
                {
                    entity.PlayerId = playerId;
                }
                break;
            case "CURRENT_PLAYER":
                if (IsTruthy(value))
                {
                    _currentPlayerId = entity.PlayerId ?? entity.ControllerId ?? gameEvent.PlayerId;
                }
                break;
            case "LOCAL_PLAYER":
                if (IsTruthy(value))
                {
                    _friendlyPlayerId = entity.PlayerId ?? entity.ControllerId ?? gameEvent.PlayerId;
                }
                break;
            case "PLAYSTATE":
                var statePlayer = entity.PlayerId ?? gameEvent.PlayerId;
                if (statePlayer.HasValue)
                {
                    _playStates[statePlayer.Value] = NormalizePlayState(value);
                }
                break;
        }

        ResolvePendingPlayedCards(entity);
    }

    private void RecordPlayedCard(CanonicalGameEvent gameEvent)
    {
        if (!gameEvent.Data.TryGetValue("blockType", out var blockType) ||
            !string.Equals(blockType, "PLAY", StringComparison.OrdinalIgnoreCase) ||
            !gameEvent.EntityId.HasValue)
        {
            return;
        }

        var entity = GetOrCreate(gameEvent.EntityId.Value);
        var cardId = gameEvent.CardId ?? entity.CardId;
        var playerId = gameEvent.PlayerId ?? entity.ControllerId ?? entity.PlayerId;
        if (string.IsNullOrWhiteSpace(cardId) || !playerId.HasValue)
        {
            if (!_pendingPlayedCards.TryGetValue(entity.Id, out var pending))
            {
                pending = [];
                _pendingPlayedCards[entity.Id] = pending;
            }

            pending.Add(playerId);
            return;
        }

        AddPlayedCard(playerId.Value, cardId);
    }

    private void ResolvePendingPlayedCards(MutableEntity entity)
    {
        if (string.IsNullOrWhiteSpace(entity.CardId) ||
            !_pendingPlayedCards.TryGetValue(entity.Id, out var pending))
        {
            return;
        }

        var unresolved = new List<int?>();
        foreach (var pendingPlayerId in pending)
        {
            var playerId = pendingPlayerId ?? entity.ControllerId ?? entity.PlayerId;
            if (playerId.HasValue)
            {
                AddPlayedCard(playerId.Value, entity.CardId);
            }
            else
            {
                unresolved.Add(null);
            }
        }

        if (unresolved.Count == 0)
        {
            _pendingPlayedCards.Remove(entity.Id);
        }
        else
        {
            _pendingPlayedCards[entity.Id] = unresolved;
        }
    }

    private void AddPlayedCard(int playerId, string cardId)
    {
        if (!_playedCards.TryGetValue(playerId, out var cards))
        {
            cards = [];
            _playedCards[playerId] = cards;
        }

        cards.Add(cardId);
    }

    private void UpdateCompletion(DateTimeOffset eventTime)
    {
        var tied = _playStates.Values.Any(state => state == "TIED");
        var winner = _playStates.FirstOrDefault(pair => pair.Value == "WON");
        if (winner.Key != 0)
        {
            _winnerPlayerId = winner.Key;
        }

        var hasLoser = _playStates.Values.Any(state => state is "LOST" or "CONCEDED");
        var allPlayersTerminal = _playStates.Count > 1 && _playStates.Values.All(IsTerminalPlayState);
        if (tied || (_winnerPlayerId.HasValue && hasLoser) || allPlayersTerminal)
        {
            _isComplete = true;
            _endedAtUtc ??= eventTime;
        }
    }

    private string? GetOutcome()
    {
        if (!_isComplete)
        {
            return null;
        }

        if (_playStates.Values.Any(value => value == "TIED"))
        {
            return "Tie";
        }

        if (!_friendlyPlayerId.HasValue || !_winnerPlayerId.HasValue)
        {
            return "Unknown";
        }

        return _friendlyPlayerId == _winnerPlayerId ? "Win" : "Loss";
    }

    private IReadOnlyDictionary<int, IReadOnlyList<string>> CopyPlayedCards()
    {
        var result = new SortedDictionary<int, IReadOnlyList<string>>();
        foreach (var (playerId, cards) in _playedCards)
        {
            result[playerId] = Array.AsReadOnly(cards.ToArray());
        }

        return new ReadOnlyDictionary<int, IReadOnlyList<string>>(result);
    }

    private MutableEntity GetOrCreate(int id)
    {
        if (!_entities.TryGetValue(id, out var entity))
        {
            entity = new MutableEntity(id);
            _entities[id] = entity;
        }

        return entity;
    }

    private static bool TryInt(string value, out int result) =>
        int.TryParse(value, NumberStyles.Integer, CultureInfo.InvariantCulture, out result);

    private static bool IsTruthy(string value) => value is "1" ||
        string.Equals(value, "true", StringComparison.OrdinalIgnoreCase);

    private static string NormalizePlayState(string value) => value switch
    {
        "2" => "WINNING",
        "3" => "LOSING",
        "4" => "WON",
        "5" => "LOST",
        "6" => "TIED",
        "7" => "DISCONNECTED",
        "8" => "CONCEDED",
        _ => value.ToUpperInvariant()
    };

    private static bool IsTerminalPlayState(string value) =>
        value is "WON" or "LOST" or "TIED" or "DISCONNECTED" or "CONCEDED";

    private sealed class MutableEntity(int id)
    {
        public int Id { get; } = id;
        public string? CardId { get; set; }
        public string? Name { get; set; }
        public int? PlayerId { get; set; }
        public int? ControllerId { get; set; }
        public string? Zone { get; set; }
        public int? ZonePosition { get; set; }
        public bool IsVisible { get; set; }
        public Dictionary<string, string> Tags { get; } = new(StringComparer.Ordinal);
    }
}
