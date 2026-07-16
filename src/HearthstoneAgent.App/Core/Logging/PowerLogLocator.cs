using System;
using System.IO;
using System.Linq;

namespace HearthstoneAgent.App.Core;

public sealed record PowerLogLocation(string Path, bool Exists, bool IsConfiguredPath);

/// <summary>Finds the active Windows Hearthstone Power.log, including timestamped log folders.</summary>
public sealed class PowerLogLocator
{
    public PowerLogLocation Locate(string? configuredPath = null)
    {
        if (!string.IsNullOrWhiteSpace(configuredPath))
        {
            var explicitPath = Path.GetFullPath(Environment.ExpandEnvironmentVariables(configuredPath));
            return new PowerLogLocation(explicitPath, File.Exists(explicitPath), true);
        }

        var expectedPath = GetExpectedPowerLogPath();
        var logsDirectory = Path.GetDirectoryName(expectedPath)!;
        var newest = FindNewestCandidate(logsDirectory);
        return newest is null
            ? new PowerLogLocation(expectedPath, File.Exists(expectedPath), false)
            : new PowerLogLocation(newest, true, false);
    }

    public static string GetExpectedPowerLogPath()
    {
        var localData = Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData);
        if (string.IsNullOrWhiteSpace(localData))
        {
            localData = Environment.GetEnvironmentVariable("LOCALAPPDATA") ?? AppContext.BaseDirectory;
        }

        return Path.Combine(localData, "Blizzard", "Hearthstone", "Logs", "Power.log");
    }

    private static string? FindNewestCandidate(string logsDirectory)
    {
        if (!Directory.Exists(logsDirectory))
        {
            return null;
        }

        try
        {
            return Directory
                .EnumerateFiles(logsDirectory, "Power.log", SearchOption.AllDirectories)
                .Select(path => new
                {
                    Path = path,
                    LastWriteUtc = TryGetLastWriteTimeUtc(path)
                })
                .Where(item => item.LastWriteUtc.HasValue)
                .OrderByDescending(item => item.LastWriteUtc)
                .Select(item => item.Path)
                .FirstOrDefault();
        }
        catch (IOException)
        {
            return null;
        }
        catch (UnauthorizedAccessException)
        {
            return null;
        }
    }

    private static DateTime? TryGetLastWriteTimeUtc(string path)
    {
        try
        {
            return File.GetLastWriteTimeUtc(path);
        }
        catch (IOException)
        {
            return null;
        }
        catch (UnauthorizedAccessException)
        {
            return null;
        }
    }
}
