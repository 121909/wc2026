using System;
using System.Collections.Generic;
using System.Globalization;
using System.Text.RegularExpressions;

namespace HearthstoneAgent.App.Core;

/// <summary>
/// Stateful, line-oriented parser for the public Power.log text format. It intentionally retains
/// unknown tag values as strings because Hearthstone adds enum values between client builds.
/// </summary>
public sealed class PowerLogParser
{
    private static readonly Regex EntityIdRegex = new(
        @"(?:EntityID|Creating ID|\bid)=(?<value>\d+)|\bEntity=(?<direct>\d+)",
        RegexOptions.Compiled | RegexOptions.CultureInvariant | RegexOptions.IgnoreCase);
    private static readonly Regex CardIdRegex = new(
        @"(?:CardID|cardId)=(?<value>[^\s\]]*)",
        RegexOptions.Compiled | RegexOptions.CultureInvariant | RegexOptions.IgnoreCase);
    private static readonly Regex PlayerIdRegex = new(
        @"(?:PlayerID|\bplayer)=(?<value>\d+)",
        RegexOptions.Compiled | RegexOptions.CultureInvariant | RegexOptions.IgnoreCase);
    private static readonly Regex TagRegex = new(
        @"\btag=(?<tag>[^\s]+)\s+value=(?<value>.*?)(?:\s+DefChange=|$)",
        RegexOptions.Compiled | RegexOptions.CultureInvariant | RegexOptions.IgnoreCase);
    private static readonly Regex NameRegex = new(
        @"(?:entityName|name)=(?<value>.*?)(?:\s+id=|\])",
        RegexOptions.Compiled | RegexOptions.CultureInvariant | RegexOptions.IgnoreCase);
    private static readonly Regex EntityNameReferenceRegex = new(
        @"\bEntity=(?<value>.*?)(?:\s+tag=|$)",
        RegexOptions.Compiled | RegexOptions.CultureInvariant | RegexOptions.IgnoreCase);
    private static readonly Regex ZoneRegex = new(
        @"\bzone=(?<value>[^\s\]]+)",
        RegexOptions.Compiled | RegexOptions.CultureInvariant | RegexOptions.IgnoreCase);
    private static readonly Regex ZonePositionRegex = new(
        @"\bzonePos=(?<value>\d+)",
        RegexOptions.Compiled | RegexOptions.CultureInvariant | RegexOptions.IgnoreCase);
    private static readonly Regex OptionIdRegex = new(
        @"(?:\bid=|\boption\s+|\bsub_?option\s+)(?<value>-?\d+)",
        RegexOptions.Compiled | RegexOptions.CultureInvariant | RegexOptions.IgnoreCase);
    private static readonly Regex TargetIndexRegex = new(
        @"^target\s+(?<value>\d+)",
        RegexOptions.Compiled | RegexOptions.CultureInvariant | RegexOptions.IgnoreCase);

    private int? _pendingEntityId;
    private readonly Dictionary<string, int> _entityIdsByName = new(StringComparer.OrdinalIgnoreCase);
    private readonly Dictionary<int, int> _entityIdsByPlayerId = [];

    public IReadOnlyList<CanonicalGameEvent> Parse(RawLogLine line)
    {
        ArgumentNullException.ThrowIfNull(line);
        var payload = ExtractPayload(line.Content);
        if (payload.Length == 0)
        {
            return Array.Empty<CanonicalGameEvent>();
        }

        if (payload.StartsWith("CREATE_GAME", StringComparison.OrdinalIgnoreCase))
        {
            _pendingEntityId = null;
            _entityIdsByName.Clear();
            _entityIdsByPlayerId.Clear();
            return Single(CreateEvent(GameEventType.CreateGame, line));
        }

        if (payload.StartsWith("FULL_ENTITY", StringComparison.OrdinalIgnoreCase))
        {
            var gameEvent = ParseEntityEvent(GameEventType.FullEntity, payload, line);
            _pendingEntityId = gameEvent.EntityId;
            RegisterEntityName(gameEvent);
            return Single(gameEvent);
        }

        if (payload.StartsWith("SHOW_ENTITY", StringComparison.OrdinalIgnoreCase))
        {
            var gameEvent = ParseEntityEvent(GameEventType.ShowEntity, payload, line);
            _pendingEntityId = gameEvent.EntityId;
            RegisterEntityName(gameEvent);
            return Single(gameEvent);
        }

        if (payload.StartsWith("HIDE_ENTITY", StringComparison.OrdinalIgnoreCase))
        {
            _pendingEntityId = null;
            return Single(ParseEntityEvent(GameEventType.HideEntity, payload, line));
        }

        if (payload.StartsWith("CHANGE_ENTITY", StringComparison.OrdinalIgnoreCase))
        {
            var gameEvent = ParseEntityEvent(GameEventType.ChangeEntity, payload, line);
            _pendingEntityId = gameEvent.EntityId;
            RegisterEntityName(gameEvent);
            return Single(gameEvent);
        }

        if (payload.StartsWith("TAG_CHANGE", StringComparison.OrdinalIgnoreCase))
        {
            _pendingEntityId = null;
            return Single(ParseTagChange(payload, line, null));
        }

        // FULL_ENTITY and SHOW_ENTITY are followed by indented tag=value lines.
        if (payload.StartsWith("tag=", StringComparison.OrdinalIgnoreCase) && _pendingEntityId.HasValue)
        {
            return Single(ParseTagChange(payload, line, _pendingEntityId));
        }

        if (payload.StartsWith("BLOCK_START", StringComparison.OrdinalIgnoreCase))
        {
            _pendingEntityId = null;
            return Single(ParseStructuredEvent(GameEventType.BlockStart, payload, line));
        }

        if (payload.StartsWith("BLOCK_END", StringComparison.OrdinalIgnoreCase))
        {
            _pendingEntityId = null;
            return Single(CreateEvent(GameEventType.BlockEnd, line));
        }

        if (payload.StartsWith("CHOICES_START", StringComparison.OrdinalIgnoreCase))
        {
            _pendingEntityId = null;
            return Single(ParseStructuredEvent(GameEventType.ChoicesStart, payload, line));
        }

        if (payload.StartsWith("CHOICES_CHOICE", StringComparison.OrdinalIgnoreCase) ||
            payload.StartsWith("CHOICE", StringComparison.OrdinalIgnoreCase))
        {
            _pendingEntityId = null;
            return Single(ParseStructuredEvent(GameEventType.Choice, payload, line));
        }

        if (payload.StartsWith("CHOICES_END", StringComparison.OrdinalIgnoreCase))
        {
            _pendingEntityId = null;
            return Single(CreateEvent(GameEventType.ChoicesEnd, line));
        }

        if (payload.StartsWith("OPTIONS_START", StringComparison.OrdinalIgnoreCase))
        {
            _pendingEntityId = null;
            return Single(ParseStructuredEvent(GameEventType.OptionsStart, payload, line));
        }

        if (payload.StartsWith("OPTIONS_END", StringComparison.OrdinalIgnoreCase))
        {
            _pendingEntityId = null;
            return Single(CreateEvent(GameEventType.OptionsEnd, line));
        }

        if (payload.StartsWith("OPTION", StringComparison.OrdinalIgnoreCase) ||
            payload.StartsWith("SUB_OPTION", StringComparison.OrdinalIgnoreCase) ||
            Regex.IsMatch(
                payload,
                @"^(?:sub_?option|option)\s+-?\d+",
                RegexOptions.IgnoreCase | RegexOptions.CultureInvariant))
        {
            _pendingEntityId = null;
            var data = ParseCommonData(payload);
            var optionId = MatchInt(OptionIdRegex, payload);
            AddIfPresent(data, "optionId", optionId?.ToString(CultureInfo.InvariantCulture));
            AddIfPresent(
                data,
                "isSubOption",
                Regex.IsMatch(payload, @"^sub_?option\b", RegexOptions.IgnoreCase | RegexOptions.CultureInvariant)
                    ? "true"
                    : null);
            return Single(CreateEvent(
                GameEventType.Option,
                line,
                ParseEntityId(payload),
                ParseCardId(payload),
                ParsePlayerId(payload),
                data: data));
        }

        if (payload.StartsWith("SEND_OPTION", StringComparison.OrdinalIgnoreCase) ||
            payload.StartsWith("selectedOption=", StringComparison.OrdinalIgnoreCase) ||
            line.Content.Contains(".SendOption()", StringComparison.OrdinalIgnoreCase))
        {
            _pendingEntityId = null;
            return Single(ParseStructuredEvent(GameEventType.SendOption, payload, line));
        }

        if (TargetIndexRegex.IsMatch(payload))
        {
            _pendingEntityId = null;
            var data = ParseCommonData(payload);
            AddIfPresent(data, "entryKind", "target");
            AddIfPresent(data, "targetIndex", MatchValue(TargetIndexRegex, payload));
            return Single(CreateEvent(
                GameEventType.Option,
                line,
                ParseEntityId(payload),
                ParseCardId(payload),
                ParsePlayerId(payload),
                data: data));
        }

        // CREATE_GAME contains these entity headers without a FULL_ENTITY marker.
        if (payload.StartsWith("GameEntity EntityID=", StringComparison.OrdinalIgnoreCase) ||
            payload.StartsWith("Player EntityID=", StringComparison.OrdinalIgnoreCase))
        {
            var data = ParseCommonData(payload);
            data["entityKind"] = payload.StartsWith("Player", StringComparison.OrdinalIgnoreCase)
                ? "player"
                : "game";
            if (payload.StartsWith("GameEntity", StringComparison.OrdinalIgnoreCase))
            {
                data["name"] = "GameEntity";
            }
            var gameEvent = CreateEvent(
                GameEventType.FullEntity,
                line,
                ParseEntityId(payload),
                ParseCardId(payload),
                ParsePlayerId(payload),
                data: data);
            _pendingEntityId = gameEvent.EntityId;
            RegisterEntityName(gameEvent);
            return Single(gameEvent);
        }

        _pendingEntityId = null;
        return Array.Empty<CanonicalGameEvent>();
    }

    public void Reset()
    {
        _pendingEntityId = null;
        _entityIdsByName.Clear();
        _entityIdsByPlayerId.Clear();
    }

    private static CanonicalGameEvent ParseEntityEvent(GameEventType type, string payload, RawLogLine line)
    {
        var data = ParseCommonData(payload);
        return CreateEvent(
            type,
            line,
            ParseEntityId(payload),
            ParseCardId(payload),
            ParsePlayerId(payload),
            data: data);
    }

    private CanonicalGameEvent ParseTagChange(string payload, RawLogLine line, int? fallbackEntityId)
    {
        var tagMatch = TagRegex.Match(payload);
        var tag = tagMatch.Success ? tagMatch.Groups["tag"].Value : null;
        var value = tagMatch.Success ? tagMatch.Groups["value"].Value.Trim() : null;
        var entityReferenceName = ParseEntityReferenceName(payload);
        var entityId = ParseEntityId(payload) ?? fallbackEntityId ?? ResolveEntityName(entityReferenceName);
        if (!entityId.HasValue &&
            string.Equals(tag, "PLAYER_ID", StringComparison.OrdinalIgnoreCase) &&
            int.TryParse(value, NumberStyles.Integer, CultureInfo.InvariantCulture, out var playerId) &&
            _entityIdsByPlayerId.TryGetValue(playerId, out var playerEntityId))
        {
            entityId = playerEntityId;
        }

        var gameEvent = CreateEvent(
            GameEventType.TagChange,
            line,
            entityId,
            ParseCardId(payload),
            ParsePlayerId(payload),
            tag,
            value,
            ParseCommonData(payload));
        if (entityId.HasValue && !string.IsNullOrWhiteSpace(entityReferenceName))
        {
            _entityIdsByName[entityReferenceName] = entityId.Value;
        }

        RegisterEntityName(gameEvent);
        return gameEvent;
    }

    private void RegisterEntityName(CanonicalGameEvent gameEvent)
    {
        if (!gameEvent.EntityId.HasValue)
        {
            return;
        }

        if (gameEvent.PlayerId.HasValue)
        {
            _entityIdsByPlayerId[gameEvent.PlayerId.Value] = gameEvent.EntityId.Value;
        }

        if (gameEvent.Data.TryGetValue("name", out var name) && !string.IsNullOrWhiteSpace(name))
        {
            _entityIdsByName[name.Trim()] = gameEvent.EntityId.Value;
        }
    }

    private int? ResolveEntityName(string? name)
    {
        if (string.IsNullOrWhiteSpace(name))
        {
            return null;
        }

        return _entityIdsByName.TryGetValue(name, out var entityId) ? entityId : null;
    }

    private static string? ParseEntityReferenceName(string payload)
    {
        var match = EntityNameReferenceRegex.Match(payload);
        if (!match.Success)
        {
            return null;
        }

        var name = match.Groups["value"].Value.Trim();
        if (name.StartsWith("[", StringComparison.Ordinal) && name.EndsWith("]", StringComparison.Ordinal))
        {
            var nestedName = MatchValue(NameRegex, name);
            if (!string.IsNullOrWhiteSpace(nestedName))
            {
                name = nestedName.Trim();
            }
        }

        return int.TryParse(name, NumberStyles.Integer, CultureInfo.InvariantCulture, out _)
            ? null
            : name;
    }

    private static CanonicalGameEvent ParseStructuredEvent(GameEventType type, string payload, RawLogLine line) =>
        CreateEvent(
            type,
            line,
            ParseEntityId(payload),
            ParseCardId(payload),
            ParsePlayerId(payload),
            data: ParseCommonData(payload));

    private static CanonicalGameEvent CreateEvent(
        GameEventType type,
        RawLogLine line,
        int? entityId = null,
        string? cardId = null,
        int? playerId = null,
        string? tag = null,
        string? value = null,
        IReadOnlyDictionary<string, string>? data = null) => new()
        {
            ObservedAtUtc = line.ObservedAtUtc,
            Type = type,
            EntityId = entityId,
            CardId = string.IsNullOrWhiteSpace(cardId) ? null : cardId,
            PlayerId = playerId,
            Tag = tag,
            Value = value,
            RawLineNumber = line.LineNumber,
            RawByteOffset = line.ByteOffset,
            Data = data ?? EmptyReadOnlyDictionary<string, string>.Instance
        };

    private static Dictionary<string, string> ParseCommonData(string payload)
    {
        var data = new Dictionary<string, string>(StringComparer.Ordinal);
        AddIfPresent(data, "name", MatchValue(NameRegex, payload));
        AddIfPresent(data, "zone", MatchValue(ZoneRegex, payload));
        AddIfPresent(data, "zonePosition", MatchValue(ZonePositionRegex, payload));
        AddIfPresent(data, "blockType", MatchToken(payload, "BlockType"));
        AddIfPresent(data, "choiceType", MatchToken(payload, "ChoiceType"));
        AddIfPresent(data, "effectCardId", MatchToken(payload, "EffectCardId"));
        AddIfPresent(data, "effectIndex", MatchToken(payload, "EffectIndex"));
        AddIfPresent(data, "selectedOption", MatchToken(payload, "selectedOption"));
        AddIfPresent(data, "selectedSubOption", MatchToken(payload, "selectedSubOption"));
        AddIfPresent(data, "selectedTarget", MatchToken(payload, "selectedTarget"));
        AddIfPresent(data, "selectedPosition", MatchToken(payload, "selectedPosition"));
        AddIfPresent(data, "type", MatchToken(payload, "type"));
        AddIfPresent(data, "error", MatchToken(payload, "error"));
        return data;
    }

    private static int? ParseEntityId(string payload) => MatchInt(EntityIdRegex, payload);
    private static string? ParseCardId(string payload) => MatchValue(CardIdRegex, payload);
    private static int? ParsePlayerId(string payload) => MatchInt(PlayerIdRegex, payload);

    private static int? MatchInt(Regex regex, string input)
    {
        var match = regex.Match(input);
        if (!match.Success)
        {
            return null;
        }

        var value = match.Groups["value"].Success
            ? match.Groups["value"].Value
            : match.Groups["direct"].Value;
        return int.TryParse(value, NumberStyles.Integer, CultureInfo.InvariantCulture, out var parsed)
            ? parsed
            : null;
    }

    private static string? MatchValue(Regex regex, string input)
    {
        var match = regex.Match(input);
        return match.Success ? match.Groups["value"].Value : null;
    }

    private static string? MatchToken(string input, string key)
    {
        var match = Regex.Match(
            input,
            $@"(?:^|\s){Regex.Escape(key)}=(?<value>[^\s\]]*)",
            RegexOptions.IgnoreCase | RegexOptions.CultureInvariant);
        return match.Success ? match.Groups["value"].Value : null;
    }

    private static void AddIfPresent(IDictionary<string, string> target, string key, string? value)
    {
        if (!string.IsNullOrWhiteSpace(value))
        {
            target[key] = value;
        }
    }

    private static string ExtractPayload(string line)
    {
        var separator = line.IndexOf(" - ", StringComparison.Ordinal);
        return (separator >= 0 ? line[(separator + 3)..] : line).TrimStart();
    }

    private static IReadOnlyList<CanonicalGameEvent> Single(CanonicalGameEvent gameEvent) => [gameEvent];
}
