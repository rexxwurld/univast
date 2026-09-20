using CommunityToolkit.Mvvm.ComponentModel;
using CommunityToolkit.Mvvm.Input;
using UNIVAST.Mobile.Services;

namespace UNIVAST.Mobile.ViewModels;

public partial class RegisterViewModel : ObservableObject
{
    private readonly AuthService _authService;

    public RegisterViewModel(AuthService authService)
    {
        _authService = authService;
    }

    [ObservableProperty]
    private string _name = "";

    [ObservableProperty]
    private string _email = "";

    [ObservableProperty]
    private string _password = "";

    [ObservableProperty]
    [NotifyPropertyChangedFor(nameof(HasError))]
    private string? _errorMessage;

    [ObservableProperty]
    [NotifyCanExecuteChangedFor(nameof(RegisterCommand))]
    private bool _isBusy;

    public bool HasError => !string.IsNullOrEmpty(ErrorMessage);

    [RelayCommand(CanExecute = nameof(CanRegister))]
    private async Task RegisterAsync()
    {
        var name = Name.Trim();
        var email = Email.Trim();

        if (string.IsNullOrWhiteSpace(name) || string.IsNullOrWhiteSpace(email) || string.IsNullOrWhiteSpace(Password))
        {
            ErrorMessage = "Fill in every field.";
            return;
        }
        if (Password.Length < 8)
        {
            ErrorMessage = "Password must be at least 8 characters.";
            return;
        }

        IsBusy = true;
        ErrorMessage = null;
        try
        {
            await _authService.RegisterAsync(name, email, Password);
            // Pop back twice: RegisterPage -> LoginPage -> the page that started the flow.
            await Shell.Current.GoToAsync("../..");
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

    private bool CanRegister() => !IsBusy;
}
