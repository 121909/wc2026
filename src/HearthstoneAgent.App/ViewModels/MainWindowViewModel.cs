using System.Collections.ObjectModel;
using System.Diagnostics;
using System.Globalization;
using System.IO;
using System.Windows;
using System.Windows.Media;
using System.Windows.Threading;
using HearthstoneAgent.App.Core;
using Microsoft.Win32;

namespace HearthstoneAgent.App.ViewModels;

public sealed class MainWindowViewModel : ObservableObject, IAsyncDisposable
{
    private readonly Dispatcher _dispatcher;
    private readonly JsonSettingsStore _settingsStore = new();
    private readonly PowerLogLocator _logLocator = new();
    private AppSettings _settings;
    private RecorderService? _recorder;
    private string _powerLogPath = string.Empty;
    private bool _useAutomaticLogLocation;
    private string _outputDirectory = string.Empty;
    private bool _readExistingLogOnStart;
    private bool _isRecording;
    private bool _isBusy;
    private string _recorderStateText = "已停止";
    private string _statusMessage = "请确认 Power.log 路径，然后开始记录。";
    private Brush _statusBrush;
    private string _sessionPath = "尚未创建记录会话。";
    private string _matchId = "—";
    private string _matchPhase = "等待";
    private string _turnText = "—";
    private string _eventCountText = "0";
    private string _entityCountText = "0";
    private string _currentPlayer = "未知";
    private string _lastEvent = "尚未收到对局事件。";
    private string _footerStatus = "就绪";
    private bool _disposed;

    public MainWindowViewModel(Dispatcher dispatcher)
    {
        _dispatcher = dispatcher ?? throw new ArgumentNullException(nameof(dispatcher));
        _statusBrush = FindBrush("TextMutedBrush", Brushes.SlateGray);
        _settings = LoadSettingsOrDefault();
        var located = _logLocator.Locate(_settings.PowerLogPath);
        _useAutomaticLogLocation = string.IsNullOrWhiteSpace(_settings.PowerLogPath);
        _powerLogPath = located.Path;
        _outputDirectory = _settings.DataDirectory;
        _readExistingLogOnStart = _settings.ReadExistingLogOnStart;

        RecentEvents = [];
        RecentEvents.Add("记录器尚未启动。开始后，此处显示最近 200 条规范事件。");

        AutoLocateCommand = new RelayCommand(AutoLocate, () => CanEditSettings);
        BrowsePowerLogCommand = new RelayCommand(BrowsePowerLog, () => CanEditSettings);
        BrowseOutputCommand = new RelayCommand(BrowseOutput, () => CanEditSettings);
        OpenOutputCommand = new RelayCommand(OpenOutput);
        StartCommand = new AsyncRelayCommand(StartAsync, () => CanStart);
        StopCommand = new AsyncRelayCommand(StopAsync, () => CanStop);

        if (!located.Exists)
        {
            StatusMessage = "尚未找到 Power.log。应用可以启动后等待文件出现，也可以手动选择路径。";
            StatusBrush = FindBrush("WarningBrush", Brushes.Goldenrod);
        }
    }

    public ObservableCollection<string> RecentEvents { get; }

    public RelayCommand AutoLocateCommand { get; }
    public RelayCommand BrowsePowerLogCommand { get; }
    public RelayCommand BrowseOutputCommand { get; }
    public RelayCommand OpenOutputCommand { get; }
    public AsyncRelayCommand StartCommand { get; }
    public AsyncRelayCommand StopCommand { get; }

    public string PowerLogPath
    {
        get => _powerLogPath;
        set
        {
            _useAutomaticLogLocation = false;
            SetProperty(ref _powerLogPath, value);
        }
    }

    public string OutputDirectory
    {
        get => _outputDirectory;
        set => SetProperty(ref _outputDirectory, value);
    }

    public bool ReadExistingLogOnStart
    {
        get => _readExistingLogOnStart;
        set => SetProperty(ref _readExistingLogOnStart, value);
    }

    public bool IsRecording
    {
        get => _isRecording;
        private set
        {
            if (!SetProperty(ref _isRecording, value))
            {
                return;
            }

            RaiseCommandStateChanged();
            OnPropertyChanged(nameof(CanEditSettings));
            OnPropertyChanged(nameof(CanStart));
            OnPropertyChanged(nameof(CanStop));
        }
    }

    public bool CanEditSettings => !IsRecording && !_isBusy;
    public bool CanStart => !IsRecording && !_isBusy && _recorder is null;
    public bool CanStop => IsRecording && !_isBusy;

    public string RecorderStateText
    {
        get => _recorderStateText;
        private set => SetProperty(ref _recorderStateText, value);
    }

    public string StatusMessage
    {
        get => _statusMessage;
        private set => SetProperty(ref _statusMessage, value);
    }

    public Brush StatusBrush
    {
        get => _statusBrush;
        private set => SetProperty(ref _statusBrush, value);
    }

    public string SessionPath
    {
        get => _sessionPath;
        private set => SetProperty(ref _sessionPath, value);
    }

    public string MatchId
    {
        get => _matchId;
        private set => SetProperty(ref _matchId, value);
    }

    public string MatchPhase
    {
        get => _matchPhase;
        private set => SetProperty(ref _matchPhase, value);
    }

    public string TurnText
    {
        get => _turnText;
        private set => SetProperty(ref _turnText, value);
    }

    public string EventCountText
    {
        get => _eventCountText;
        private set => SetProperty(ref _eventCountText, value);
    }

    public string EntityCountText
    {
        get => _entityCountText;
        private set => SetProperty(ref _entityCountText, value);
    }

    public string CurrentPlayer
    {
        get => _currentPlayer;
        private set => SetProperty(ref _currentPlayer, value);
    }

    public string LastEvent
    {
        get => _lastEvent;
        private set => SetProperty(ref _lastEvent, value);
    }

    public string FooterStatus
    {
        get => _footerStatus;
        private set => SetProperty(ref _footerStatus, value);
    }

    public async ValueTask DisposeAsync()
    {
        if (_disposed)
        {
            return;
        }

        _disposed = true;
        if (_recorder is not null)
        {
            DetachRecorder(_recorder);
            await _recorder.DisposeAsync();
            _recorder = null;
        }
    }

    private AppSettings LoadSettingsOrDefault()
    {
        try
        {
            return _settingsStore.LoadAsync().GetAwaiter().GetResult();
        }
        catch (Exception exception)
        {
            StatusMessage = $"读取 settings.json 失败，将使用默认设置：{exception.Message}";
            StatusBrush = FindBrush("WarningBrush", Brushes.Goldenrod);
            return new AppSettings();
        }
    }

    private void AutoLocate()
    {
        var location = _logLocator.Locate();
        _useAutomaticLogLocation = true;
        SetProperty(ref _powerLogPath, location.Path, nameof(PowerLogPath));
        StatusMessage = location.Exists
            ? $"已找到 Power.log：{location.Path}"
            : $"尚未找到日志。开始记录后会等待此路径出现：{location.Path}";
        StatusBrush = location.Exists
            ? FindBrush("InfoBrush", Brushes.DeepSkyBlue)
            : FindBrush("WarningBrush", Brushes.Goldenrod);
        FooterStatus = $"路径检查于 {DateTime.Now:HH:mm:ss}";
    }

    private void BrowsePowerLog()
    {
        var dialog = new OpenFileDialog
        {
            Title = "选择 Hearthstone Power.log",
            Filter = "Power.log|Power.log|日志文件 (*.log)|*.log|所有文件 (*.*)|*.*",
            CheckFileExists = true,
            Multiselect = false
        };

        var directory = TryGetDirectory(PowerLogPath);
        if (directory is not null)
        {
            dialog.InitialDirectory = directory;
        }

        if (dialog.ShowDialog() == true)
        {
            PowerLogPath = dialog.FileName;
            StatusMessage = "已选择 Power.log。保存设置后即可开始记录。";
            StatusBrush = FindBrush("InfoBrush", Brushes.DeepSkyBlue);
        }
    }

    private void BrowseOutput()
    {
        var dialog = new OpenFolderDialog
        {
            Title = "选择对局记录输出目录",
            Multiselect = false
        };

        if (Directory.Exists(OutputDirectory))
        {
            dialog.InitialDirectory = OutputDirectory;
        }

        if (dialog.ShowDialog() == true)
        {
            OutputDirectory = dialog.FolderName;
            StatusMessage = "已选择记录目录。";
            StatusBrush = FindBrush("InfoBrush", Brushes.DeepSkyBlue);
        }
    }

    private void OpenOutput()
    {
        try
        {
            var directory = string.IsNullOrWhiteSpace(OutputDirectory)
                ? AppSettings.GetDefaultDataDirectory()
                : Environment.ExpandEnvironmentVariables(OutputDirectory.Trim());
            Directory.CreateDirectory(directory);
            Process.Start(new ProcessStartInfo
            {
                FileName = Path.GetFullPath(directory),
                UseShellExecute = true
            });
        }
        catch (Exception exception)
        {
            MessageBox.Show(
                $"无法打开记录目录：{exception.Message}",
                "Hearthstone Agent",
                MessageBoxButton.OK,
                MessageBoxImage.Warning);
        }
    }

    private async Task StartAsync()
    {
        if (string.IsNullOrWhiteSpace(PowerLogPath))
        {
            ShowValidationError("请填写或自动定位 Power.log 路径。");
            return;
        }

        if (string.IsNullOrWhiteSpace(OutputDirectory))
        {
            ShowValidationError("请选择记录输出目录。");
            return;
        }

        SetBusy(true);
        try
        {
            _settings = (_settings with
            {
                PowerLogPath = _useAutomaticLogLocation
                    ? null
                    : Environment.ExpandEnvironmentVariables(PowerLogPath.Trim()),
                DataDirectory = Environment.ExpandEnvironmentVariables(OutputDirectory.Trim()),
                ReadExistingLogOnStart = ReadExistingLogOnStart
            }).Normalize();
            await _settingsStore.SaveAsync(_settings);

            var recorder = new RecorderService(_settings, _logLocator);
            AttachRecorder(recorder);
            _recorder = recorder;
            RecentEvents.Clear();
            MatchId = "—";
            MatchPhase = "等待";
            TurnText = "—";
            EventCountText = "0";
            EntityCountText = "0";
            CurrentPlayer = "未知";
            LastEvent = "等待 CREATE_GAME。";
            IsRecording = true;
            SessionPath = Path.Combine(_settings.DataDirectory, "sessions", recorder.SessionId);
            await recorder.StartAsync();
        }
        catch (Exception exception)
        {
            await CleanupFailedStartAsync();
            IsRecording = false;
            RecorderStateText = "启动失败";
            StatusMessage = $"无法启动记录器：{exception.Message}";
            StatusBrush = FindBrush("DangerBrush", Brushes.IndianRed);
            AddRecentEvent($"ERROR 启动失败：{exception.Message}");
        }
        finally
        {
            SetBusy(false);
        }
    }

    private async Task StopAsync()
    {
        SetBusy(true);
        try
        {
            var recorder = _recorder;
            if (recorder is null)
            {
                return;
            }

            await recorder.StopAsync();
            DetachRecorder(recorder);
            await recorder.DisposeAsync();
            _recorder = null;
            IsRecording = false;
            RecorderStateText = "已停止";
            StatusMessage = "记录器已停止，当前文件已经收尾并关闭。";
            StatusBrush = FindBrush("TextMutedBrush", Brushes.SlateGray);
            FooterStatus = $"停止于 {DateTime.Now:HH:mm:ss}";
        }
        catch (Exception exception)
        {
            var recorder = _recorder;
            if (recorder is not null)
            {
                DetachRecorder(recorder);
                try
                {
                    await recorder.DisposeAsync();
                }
                catch
                {
                    // The original stop/finalization error is shown below.
                }

                _recorder = null;
            }

            IsRecording = false;
            RecorderStateText = "保存失败";
            StatusMessage = $"停止记录器时发生错误：{exception.Message}";
            StatusBrush = FindBrush("DangerBrush", Brushes.IndianRed);
            AddRecentEvent($"ERROR 停止失败：{exception.Message}");
        }
        finally
        {
            SetBusy(false);
        }
    }

    private async Task CleanupFailedStartAsync()
    {
        var recorder = _recorder;
        if (recorder is null)
        {
            return;
        }

        DetachRecorder(recorder);
        try
        {
            await recorder.DisposeAsync();
        }
        catch
        {
            // Preserve the original startup error.
        }
        finally
        {
            _recorder = null;
        }
    }

    private void AttachRecorder(RecorderService recorder)
    {
        recorder.StatusChanged += HandleStatusChanged;
        recorder.EventReceived += HandleEventReceived;
        recorder.SnapshotUpdated += HandleSnapshotUpdated;
        recorder.MatchCompleted += HandleMatchCompleted;
        recorder.Error += HandleRecorderError;
    }

    private void DetachRecorder(RecorderService recorder)
    {
        recorder.StatusChanged -= HandleStatusChanged;
        recorder.EventReceived -= HandleEventReceived;
        recorder.SnapshotUpdated -= HandleSnapshotUpdated;
        recorder.MatchCompleted -= HandleMatchCompleted;
        recorder.Error -= HandleRecorderError;
    }

    private void HandleStatusChanged(object? sender, RecorderStatusChangedEventArgs eventArgs) =>
        Dispatch(() => ApplyStatus(eventArgs.Status));

    private void HandleEventReceived(object? sender, GameEventReceivedEventArgs eventArgs) =>
        Dispatch(() =>
        {
            var gameEvent = eventArgs.GameEvent;
            LastEvent = DescribeEvent(gameEvent);
            AddRecentEvent(LastEvent);
        });

    private void HandleSnapshotUpdated(object? sender, GameStateSnapshotEventArgs eventArgs) =>
        Dispatch(() => ApplySnapshot(eventArgs.Snapshot));

    private void HandleMatchCompleted(object? sender, MatchCompletedEventArgs eventArgs) =>
        Dispatch(() =>
        {
            MatchPhase = eventArgs.Summary.IsComplete ? "已结束" : "未完成";
            StatusMessage = $"对局记录已保存：{eventArgs.MatchDirectory}";
            SessionPath = eventArgs.MatchDirectory;
            StatusBrush = eventArgs.Summary.IsComplete
                ? FindBrush("AccentBrush", Brushes.LimeGreen)
                : FindBrush("WarningBrush", Brushes.Goldenrod);
            AddRecentEvent($"MATCH {eventArgs.Summary.CompletionReason} → {eventArgs.MatchDirectory}");
        });

    private void HandleRecorderError(object? sender, RecorderErrorEventArgs eventArgs) =>
        Dispatch(() =>
        {
            StatusMessage = $"{eventArgs.Context}：{eventArgs.Exception.Message}";
            StatusBrush = eventArgs.IsRecoverable
                ? FindBrush("WarningBrush", Brushes.Goldenrod)
                : FindBrush("DangerBrush", Brushes.IndianRed);
            AddRecentEvent($"ERROR {eventArgs.Context}：{eventArgs.Exception.Message}");
        });

    private void ApplyStatus(RecorderStatus status)
    {
        RecorderStateText = status.Kind switch
        {
            RecorderStatusKind.Starting => "正在启动",
            RecorderStatusKind.WaitingForLog => "等待日志",
            RecorderStatusKind.Reading => "监听中",
            RecorderStatusKind.Stopping => "正在停止",
            RecorderStatusKind.Faulted => "发生错误",
            _ => "已停止"
        };
        StatusMessage = status.Message;
        StatusBrush = status.Kind switch
        {
            RecorderStatusKind.Reading => FindBrush("AccentBrush", Brushes.LimeGreen),
            RecorderStatusKind.Starting or RecorderStatusKind.WaitingForLog or RecorderStatusKind.Stopping =>
                FindBrush("WarningBrush", Brushes.Goldenrod),
            RecorderStatusKind.Faulted => FindBrush("DangerBrush", Brushes.IndianRed),
            _ => FindBrush("TextMutedBrush", Brushes.SlateGray)
        };
        FooterStatus = $"状态更新 {status.ChangedAtUtc.ToLocalTime():HH:mm:ss}";

        if ((status.Kind is RecorderStatusKind.Stopped or RecorderStatusKind.Faulted) && _recorder is not null)
        {
            IsRecording = _recorder.IsRunning;
        }

        if (status.Kind == RecorderStatusKind.Faulted && _recorder is not null)
        {
            IsRecording = false;
            _ = ReleaseFaultedRecorderAsync(_recorder);
        }
    }

    private void ApplySnapshot(GameStateSnapshot snapshot)
    {
        MatchId = snapshot.MatchId.ToString("D", CultureInfo.InvariantCulture);
        MatchPhase = DescribePhase(snapshot);
        TurnText = snapshot.Turn > 0
            ? snapshot.Turn.ToString(CultureInfo.InvariantCulture)
            : "—";
        EventCountText = snapshot.Version.ToString("N0", CultureInfo.CurrentCulture);
        EntityCountText = snapshot.Entities.Count.ToString("N0", CultureInfo.CurrentCulture);
        CurrentPlayer = snapshot.CurrentPlayerId?.ToString(CultureInfo.InvariantCulture) ?? "未知";
    }

    private void SetBusy(bool value)
    {
        _isBusy = value;
        OnPropertyChanged(nameof(CanEditSettings));
        OnPropertyChanged(nameof(CanStart));
        OnPropertyChanged(nameof(CanStop));
        RaiseCommandStateChanged();
    }

    private async Task ReleaseFaultedRecorderAsync(RecorderService recorder)
    {
        DetachRecorder(recorder);
        try
        {
            await recorder.DisposeAsync();
        }
        catch
        {
            // The original recorder error is already shown in the UI.
        }

        Dispatch(() =>
        {
            if (ReferenceEquals(_recorder, recorder))
            {
                _recorder = null;
                OnPropertyChanged(nameof(CanStart));
                RaiseCommandStateChanged();
            }
        });
    }

    private void RaiseCommandStateChanged()
    {
        AutoLocateCommand.RaiseCanExecuteChanged();
        BrowsePowerLogCommand.RaiseCanExecuteChanged();
        BrowseOutputCommand.RaiseCanExecuteChanged();
        StartCommand.RaiseCanExecuteChanged();
        StopCommand.RaiseCanExecuteChanged();
    }

    private void AddRecentEvent(string text)
    {
        RecentEvents.Insert(0, text);
        while (RecentEvents.Count > 200)
        {
            RecentEvents.RemoveAt(RecentEvents.Count - 1);
        }
    }

    private void Dispatch(Action action)
    {
        if (_dispatcher.CheckAccess())
        {
            action();
        }
        else
        {
            _dispatcher.BeginInvoke(action, DispatcherPriority.Background);
        }
    }

    private void ShowValidationError(string message)
    {
        StatusMessage = message;
        StatusBrush = FindBrush("DangerBrush", Brushes.IndianRed);
        MessageBox.Show(message, "Hearthstone Agent", MessageBoxButton.OK, MessageBoxImage.Warning);
    }

    private static string DescribeEvent(CanonicalGameEvent gameEvent)
    {
        var details = new List<string>();
        if (gameEvent.EntityId.HasValue)
        {
            details.Add($"entity={gameEvent.EntityId.Value}");
        }

        if (!string.IsNullOrWhiteSpace(gameEvent.CardId))
        {
            details.Add($"card={gameEvent.CardId}");
        }

        if (!string.IsNullOrWhiteSpace(gameEvent.Tag))
        {
            details.Add($"{gameEvent.Tag}={gameEvent.Value}");
        }

        var suffix = details.Count == 0 ? string.Empty : $" · {string.Join(" · ", details)}";
        return $"[{gameEvent.ObservedAtUtc.ToLocalTime():HH:mm:ss.fff}] #{gameEvent.Sequence:00000} {gameEvent.Type}{suffix}";
    }

    private static string DescribePhase(GameStateSnapshot snapshot)
    {
        if (snapshot.IsComplete)
        {
            return "已结束";
        }

        var step = snapshot.Step ?? string.Empty;
        if (step.Contains("MULLIGAN", StringComparison.OrdinalIgnoreCase))
        {
            return "换牌";
        }

        if (step.Contains("MAIN", StringComparison.OrdinalIgnoreCase))
        {
            return "对局中";
        }

        return snapshot.Version > 0 ? "初始化" : "等待";
    }

    private static string? TryGetDirectory(string path)
    {
        try
        {
            var expanded = Environment.ExpandEnvironmentVariables(path);
            return File.Exists(expanded) ? Path.GetDirectoryName(expanded) : null;
        }
        catch
        {
            return null;
        }
    }

    private static Brush FindBrush(string resourceKey, Brush fallback) =>
        Application.Current.TryFindResource(resourceKey) as Brush ?? fallback;
}
