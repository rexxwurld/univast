using System.Globalization;
using CommunityToolkit.Mvvm.Messaging;
using UNIVAST.Mobile.Models;
using UNIVAST.Mobile.Services;

namespace UNIVAST.Mobile.Pages;

/// <summary>
/// Lets a signed-in user add a place at their current location. Opened from MainPage with the
/// map's last known coordinates (?lat=&amp;lng=). The address is auto-filled through the backend's
/// reverse-geocoding endpoint; one optional photo is uploaded first, then attached to the place.
/// </summary>
[QueryProperty(nameof(LatText), "lat")]
[QueryProperty(nameof(LngText), "lng")]
public partial class AddPlacePage : ContentPage
{
    private const long MaxPhotoBytes = 5 * 1024 * 1024; // matches the backend's multer limit

    private readonly DiscoveryApiService _discoveryApi;
    private List<CategoryDto> _categories = new();
    private FileResult? _photo;
    private bool _initialized;

    public string LatText { get; set; } = "";
    public string LngText { get; set; } = "";

    public AddPlacePage(DiscoveryApiService discoveryApi)
    {
        InitializeComponent();
        _discoveryApi = discoveryApi;
    }

    private bool TryGetCoordinates(out double latitude, out double longitude)
    {
        latitude = longitude = 0;
        return double.TryParse(LatText, NumberStyles.Float, CultureInfo.InvariantCulture, out latitude)
            && double.TryParse(LngText, NumberStyles.Float, CultureInfo.InvariantCulture, out longitude);
    }

    protected override async void OnAppearing()
    {
        base.OnAppearing();
        if (_initialized) return;
        _initialized = true;

        if (!TryGetCoordinates(out var lat, out var lng))
        {
            ShowError("Couldn't read your location. Go back and try again.");
            SubmitButton.IsEnabled = false;
            return;
        }

        LocationLabel.Text = $"Location: {lat:0.0000}, {lng:0.0000} (your current position)";

        await Task.WhenAll(LoadCategoriesAsync(), FillAddressAsync(lat, lng));
    }

    private async Task LoadCategoriesAsync()
    {
        try
        {
            _categories = await _discoveryApi.GetCategoriesAsync();
            CategoryPicker.ItemsSource = _categories.Select(c => c.Name).ToList();
        }
        catch (Exception)
        {
            ShowError("Couldn't load categories. Check your connection and reopen this screen.");
        }
    }

    private async Task FillAddressAsync(double lat, double lng)
    {
        try
        {
            var address = await _discoveryApi.ReverseGeocodeAsync(lat, lng);
            if (!string.IsNullOrWhiteSpace(address) && string.IsNullOrWhiteSpace(AddressEntry.Text))
            {
                AddressEntry.Text = address.Length > 300 ? address[..300] : address;
            }
        }
        catch (Exception)
        {
            // Address autofill is a convenience; the user can type it.
        }
    }

    private async void Photo_Clicked(object sender, EventArgs e)
    {
        try
        {
            var picked = await MediaPicker.Default.PickPhotoAsync();
            if (picked is null) return;

            _photo = picked;
            PhotoLabel.Text = picked.FileName;
            PhotoButton.Text = "Change photo";
            ErrorLabel.IsVisible = false;
        }
        catch (Exception)
        {
            ShowError("Couldn't open the photo picker.");
        }
    }

    private static string GuessContentType(FileResult file)
    {
        var ext = Path.GetExtension(file.FileName).ToLowerInvariant();
        return ext switch
        {
            ".png" => "image/png",
            ".webp" => "image/webp",
            _ => "image/jpeg",
        };
    }

    private async void Submit_Clicked(object sender, EventArgs e)
    {
        var name = NameEntry.Text?.Trim() ?? "";
        if (name.Length == 0)
        {
            ShowError("Enter a name for the place.");
            return;
        }

        if (CategoryPicker.SelectedIndex < 0 || CategoryPicker.SelectedIndex >= _categories.Count)
        {
            ShowError("Choose a category.");
            return;
        }

        if (!TryGetCoordinates(out var lat, out var lng))
        {
            ShowError("Couldn't read your location. Go back and try again.");
            return;
        }

        var website = WebsiteEntry.Text?.Trim() ?? "";
        if (website.Length > 0 && !website.StartsWith("http", StringComparison.OrdinalIgnoreCase))
        {
            website = "https://" + website;
        }

        SetBusy(true);
        try
        {
            var request = new CreatePlaceRequest
            {
                Name = name,
                Category = _categories[CategoryPicker.SelectedIndex].Id,
                Latitude = lat,
                Longitude = lng,
                Description = NullIfBlank(DescriptionEditor.Text),
                Address = NullIfBlank(AddressEntry.Text),
                Phone = NullIfBlank(PhoneEntry.Text),
                Website = NullIfBlank(website),
            };

            if (_photo is not null)
            {
                await using var stream = await _photo.OpenReadAsync();
                if (stream.CanSeek && stream.Length > MaxPhotoBytes)
                {
                    ShowError("That photo is larger than 5 MB. Pick a smaller one.");
                    return;
                }

                var url = await _discoveryApi.UploadImageAsync(stream, _photo.FileName, GuessContentType(_photo));
                request.Photos = new List<string> { url };
            }

            await _discoveryApi.CreatePlaceAsync(request);

            WeakReferenceMessenger.Default.Send(new PlaceCreatedMessage());
            await DisplayAlertAsync("Place added", $"\"{name}\" is now on the map.", "OK");
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

    private static string? NullIfBlank(string? value) =>
        string.IsNullOrWhiteSpace(value) ? null : value.Trim();

    private void ShowError(string message)
    {
        ErrorLabel.Text = message;
        ErrorLabel.IsVisible = true;
    }

    private void SetBusy(bool busy)
    {
        SubmitButton.IsEnabled = !busy;
        LoadingIndicator.IsRunning = busy;
        LoadingIndicator.IsVisible = busy;
    }
}
