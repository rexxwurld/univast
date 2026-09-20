using CommunityToolkit.Mvvm.ComponentModel;
using CommunityToolkit.Mvvm.Input;
using UNIVAST.Mobile.Pages;
using UNIVAST.Mobile.Services;

namespace UNIVAST.Mobile.ViewModels;

public partial class LoginViewModel : ObservableObject
{
    private readonly AuthService _authService;

    public LoginViewModel(AuthService authService)
    {
        _authService = authService;
    }

    [ObservableProperty]
    private string _email = "";

    [ObservableProperty]
    private string _password = "";

    [ObservableProperty]
    [NotifyPropertyChangedFor(nameof(HasError))]
    private string? _errorMessage;

    [ObservableProperty]
    [NotifyCanExecuteChangedFor(nameof(LoginCommand))]
    private bool _isBusy;

    public bool HasError => !string.IsNullOrEmpty(ErrorMessage);

    [RelayCommand(CanExecute = nameof(CanLogin))]
    private async Task LoginAsync()
    {
        var email = Email.Trim();

        if (string.IsNullOrWhiteSpace(email) || string.IsNullOrWhiteSpace(Password))
        {
            ErrorMessage = "Enter your email and password.";
            return;
        }

        IsBusy = true;
        ErrorMessage = null;
        try
        {
            await _authService.LoginAsync(email, Password);
            // Pop back to whatever page (e.g. PlaceDetailPage) sent the user here.
            await Shell.Current.GoToAsync("..");
        }
        catch (UnivastApiException ex)
        {
            ErrorMessage = ex.Message;
        }
        catch (Exception)
        {
            ErrorMessage = "Couldn't reach the server. Check your connection and try again.";
        }
        finally
        {
            IsBusy = false;
        }
    }

    private bool CanLogin() => !IsBusy;

    [RelayCommand]
    private Task GoToRegisterAsync() => Shell.Current.GoToAsync(nameof(RegisterPage));
}
