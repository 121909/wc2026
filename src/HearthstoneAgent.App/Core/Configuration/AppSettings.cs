using System;
using System.IO;
using System.Text.Json;
using System.Text.Json.Serialization;
using System.Threading;
using System.Threading.Tasks;

namespace HearthstoneAgent.App.Core;

/// <summary>Persisted recorder configuration. All paths may be changed before StartAsync.</summary>
public sealed record AppSettings
{
    public int SchemaVersion { get; init; } = 1;
    public string? PowerLogPath { get; init; }
    public string DataDirectory { get; init; } = GetDefaultDataDirectory();
    public bool ReadExistingLogOnStart { get; init; }
    public int PollIntervalMilliseconds { get; init; } = 250;
    public int SnapshotEveryEvents { get; init; } = 25;
    public bool PersistRawLines { get; init; } = true;

    public static string GetDefaultApplicationDirectory()
    {
        var localData = Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData);
        if (string.IsNullOrWhiteSpace(localData))
        {
            localData = AppContext.BaseDirectory;
        }

        return Path.Combine(localData, "HearthstoneAgent");
    }

    public static string GetDefaultDataDirectory() => GetDefaultApplicationDirectory();

    internal AppSettings Normalize()
    {
        var dataDirectory = string.IsNullOrWhiteSpace(DataDirectory)
            ? GetDefaultDataDirectory()
            : Environment.ExpandEnvironmentVariables(DataDirectory.Trim());

        var logPath = string.IsNullOrWhiteSpace(PowerLogPath)
            ? null
            : Environment.ExpandEnvironmentVariables(PowerLogPath.Trim());

        return this with
        {
            DataDirectory = Path.GetFullPath(dataDirectory),
            PowerLogPath = logPath is null ? null : Path.GetFullPath(logPath),
            PollIntervalMilliseconds = Math.Clamp(PollIntervalMilliseconds, 100, 10_000),
            SnapshotEveryEvents = Math.Clamp(SnapshotEveryEvents, 1, 10_000)
        };
    }
}

/// <summary>Loads and atomically stores settings.json without any external dependencies.</summary>
public sealed class JsonSettingsStore
{
    public JsonSettingsStore(string? settingsPath = null)
    {
        SettingsPath = Path.GetFullPath(settingsPath ?? GetDefaultSettingsPath());
    }

    public string SettingsPath { get; }

    public static string GetDefaultSettingsPath() =>
        Path.Combine(AppSettings.GetDefaultApplicationDirectory(), "settings.json");

    public async Task<AppSettings> LoadAsync(CancellationToken cancellationToken = default)
    {
        if (!File.Exists(SettingsPath))
        {
            return new AppSettings().Normalize();
        }

        await using var stream = new FileStream(
            SettingsPath,
            FileMode.Open,
            FileAccess.Read,
            FileShare.ReadWrite,
            16 * 1024,
            FileOptions.Asynchronous | FileOptions.SequentialScan);

        var settings = await JsonSerializer.DeserializeAsync<AppSettings>(
            stream,
            RecorderJson.Options,
            cancellationToken).ConfigureAwait(false);

        return (settings ?? new AppSettings()).Normalize();
    }

    public async Task SaveAsync(AppSettings settings, CancellationToken cancellationToken = default)
    {
        ArgumentNullException.ThrowIfNull(settings);
        var normalized = settings.Normalize();
        var directory = Path.GetDirectoryName(SettingsPath)
            ?? throw new InvalidOperationException("The settings path does not have a parent directory.");
        Directory.CreateDirectory(directory);

        var temporaryPath = SettingsPath + ".tmp";
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
                    normalized,
                    RecorderJson.Options,
                    cancellationToken).ConfigureAwait(false);
                await stream.FlushAsync(cancellationToken).ConfigureAwait(false);
            }

            File.Move(temporaryPath, SettingsPath, true);
        }
        finally
        {
            if (File.Exists(temporaryPath))
            {
                File.Delete(temporaryPath);
            }
        }
    }
}

internal static class RecorderJson
{
    public static JsonSerializerOptions Options { get; } = CreateOptions();

    private static JsonSerializerOptions CreateOptions()
    {
        var options = new JsonSerializerOptions
        {
            PropertyNamingPolicy = JsonNamingPolicy.CamelCase,
            WriteIndented = true,
            DefaultIgnoreCondition = JsonIgnoreCondition.WhenWritingNull
        };
        options.Converters.Add(new JsonStringEnumConverter(JsonNamingPolicy.CamelCase));
        return options;
    }

    public static JsonSerializerOptions JsonLinesOptions { get; } = CreateJsonLinesOptions();

    private static JsonSerializerOptions CreateJsonLinesOptions()
    {
        var options = new JsonSerializerOptions(Options)
        {
            WriteIndented = false
        };
        return options;
    }
}
