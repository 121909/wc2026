using System.ComponentModel;
using System.Windows;
using HearthstoneAgent.App.ViewModels;

namespace HearthstoneAgent.App;

public partial class MainWindow : Window
{
    private readonly MainWindowViewModel _viewModel;
    private bool _closeRequested;
    private bool _shutdownComplete;

    public MainWindow()
    {
        InitializeComponent();
        _viewModel = new MainWindowViewModel(Dispatcher);
        DataContext = _viewModel;
    }

    protected override void OnClosing(CancelEventArgs e)
    {
        if (_shutdownComplete)
        {
            base.OnClosing(e);
            return;
        }

        e.Cancel = true;
        if (_closeRequested)
        {
            return;
        }

        _closeRequested = true;
        IsEnabled = false;
        Title = "Hearthstone Agent Recorder · 正在保存记录…";
        _ = FlushAndCloseAsync();
    }

    private async Task FlushAndCloseAsync()
    {
        try
        {
            await _viewModel.DisposeAsync();
        }
        catch (Exception exception)
        {
            MessageBox.Show(
                $"关闭时未能完整保存记录：{exception.Message}",
                "Hearthstone Agent",
                MessageBoxButton.OK,
                MessageBoxImage.Warning);
        }
        finally
        {
            _shutdownComplete = true;
            Close();
        }
    }
}
