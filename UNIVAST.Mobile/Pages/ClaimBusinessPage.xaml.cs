using UNIVAST.Mobile.Models;
using UNIVAST.Mobile.Services;

namespace UNIVAST.Mobile.Pages;

[QueryProperty(nameof(PlaceId), "placeId")]
public partial class ClaimBusinessPage : ContentPage
{
    private readonly BusinessApiService _businessApi;
    private List<BusinessDto> _myBusinesses = new();

    public string PlaceId { get; set; } = "";

    public ClaimBusinessPage(BusinessApiService businessApi)
    {
        InitializeComponent();
        _businessApi = businessApi;
    }

    protected override void OnAppearing()
    {
        base.OnAppearing();
        _ = LoadAsync();
    }

    private async Task LoadAsync()
    {
        LoadingIndicator.IsVisible = true;
        LoadingIndicator.IsRunning = true;
        ContentScroll.IsVisible = false;

        try
        {
            _myBusinesses = await _businessApi.GetMineAsync();
        }
        catch (Exception)
        {
            _myBusinesses = new List<BusinessDto>();
        }

        if (_myBusinesses.Count > 0)
        {
            BusinessPicker.ItemsSource = _myBusinesses.Select(b => b.Name).ToList();
            BusinessPicker.SelectedIndex = 0;
            PickExistingSection.IsVisible = true;
            CreateNewSection.IsVisible = false;
        }
        else
        {
            PickExistingSection.IsVisible = false;
            CreateNewSection.IsVisible = true;
        }

        LoadingIndicator.IsVisible = false;
        LoadingIndicator.IsRunning = false;
        ContentScroll.IsVisible = true;
    }

    private async void ClaimWithSelected_Clicked(object sender, EventArgs e)
    {
        var index = BusinessPicker.SelectedIndex;
        if (index < 0 || index >= _myBusinesses.Count)
        {
            ShowError("Choose a business first.");
            return;
        }

        await ClaimAsync(_myBusinesses[index].Id);
    }

    private async void CreateAndClaim_Clicked(object sender, EventArgs e)
    {
        var name = BusinessNameEntry.Text?.Trim() ?? "";
        if (string.IsNullOrWhiteSpace(name))
        {
            ShowError("Enter a business name.");
            return;
        }

        SetBusy(true);
        try
        {
            var business = await _businessApi.CreateAsync(name, BusinessDescriptionEntry.Text?.Trim() ?? "");
            await ClaimAsync(business.Id);
        }
        catch (UnivastApiException ex)
        {
            ShowError(ex.Message);
        }
        catch (Exception)
        {
            ShowError("Couldn't reach the server. Check your connection and try again.");
        }
        finally
        {
            SetBusy(false);
        }
    }

    private async Task ClaimAsync(string businessId)
    {
        SetBusy(true);
        try
        {
            await _businessApi.ClaimPlaceAsync(PlaceId, businessId);
            await DisplayAlertAsync("Claimed", "This place is now linked to your business.", "OK");
            await Shell.Current.GoToAsync("..");
        }
        catch (UnivastApiException ex)
        {
            ShowError(ex.Message);
        }
        catch (Exception)
        {
            ShowError("Couldn't reach the server. Check your connection and try again.");
        }
        finally
        {
            SetBusy(false);
        }
    }

    private void ShowError(string message)
    {
        ErrorLabel.Text = message;
        ErrorLabel.IsVisible = true;
    }

    private void SetBusy(bool busy)
    {
        SubmitLoadingIndicator.IsRunning = busy;
        SubmitLoadingIndicator.IsVisible = busy;
        ClaimWithSelectedButton.IsEnabled = !busy;
        CreateAndClaimButton.IsEnabled = !busy;
        if (busy) ErrorLabel.IsVisible = false;
    }
}
