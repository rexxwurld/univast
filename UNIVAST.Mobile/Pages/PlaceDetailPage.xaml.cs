using Microsoft.Maui.ApplicationModel;
using Microsoft.Maui.ApplicationModel.Communication;
using Microsoft.Maui.Devices.Sensors;
using UNIVAST.Mobile.Models;
using UNIVAST.Mobile.Services;

namespace UNIVAST.Mobile.Pages;

[QueryProperty(nameof(PlaceId), "placeId")]
public partial class PlaceDetailPage : ContentPage
{
    private readonly DiscoveryApiService _discoveryApi;
    private readonly AuthService _authService;
    private readonly ReviewsApiService _reviewsApi;
    private readonly ReportApiService _reportApi;
    private PlaceDto? _place;

    public string PlaceId { get; set; } = "";

    public PlaceDetailPage(DiscoveryApiService discoveryApi, AuthService authService, ReviewsApiService reviewsApi, ReportApiService reportApi)
    {
        InitializeComponent();
        _discoveryApi = discoveryApi;
        _authService = authService;
        _reviewsApi = reviewsApi;
        _reportApi = reportApi;
    }

    protected override void OnAppearing()
    {
        base.OnAppearing();
        _ = LoadAsync();
    }

    private async Task LoadAsync()
    {
        if (string.IsNullOrWhiteSpace(PlaceId))
        {
            ShowError();
            return;
        }

        LoadingIndicator.IsVisible = true;
        LoadingIndicator.IsRunning = true;
        ErrorLabel.IsVisible = false;
        ContentScroll.IsVisible = false;

        try
        {
            _place = await _discoveryApi.GetPlaceAsync(PlaceId);
            Render(_place);
            _ = LoadReviewsAsync();
        }
        catch (Exception)
        {
            ShowError();
        }
        finally
        {
            LoadingIndicator.IsVisible = false;
            LoadingIndicator.IsRunning = false;
        }
    }

    private async Task LoadReviewsAsync()
    {
        List<ReviewDto> reviews;
        try
        {
            reviews = await _reviewsApi.GetByPlaceAsync(PlaceId, limit: 10);
        }
        catch (Exception)
        {
            // A failed reviews fetch shouldn't block the rest of the place detail
            // from being usable — just leave the section empty.
            return;
        }

        ReviewsList.Children.Clear();

        if (reviews.Count == 0)
        {
            NoReviewsLabel.IsVisible = true;
            return;
        }

        NoReviewsLabel.IsVisible = false;
        foreach (var review in reviews)
        {
            var stars = new string('★', review.Rating) + new string('☆', 5 - review.Rating);
            var authorName = string.IsNullOrWhiteSpace(review.User?.Name) ? "Anonymous" : review.User!.Name;

            var card = new Border
            {
                BackgroundColor = Colors.White,
                StrokeThickness = 0,
                Padding = new Thickness(14, 10),
                StrokeShape = new Microsoft.Maui.Controls.Shapes.RoundRectangle { CornerRadius = 12 },
                Content = new Grid
                {
                    ColumnDefinitions =
                    {
                        new ColumnDefinition { Width = GridLength.Star },
                        new ColumnDefinition { Width = GridLength.Auto }
                    },
                    Children =
                    {
                        new VerticalStackLayout
                        {
                            Spacing = 4,
                            Children =
                            {
                                new Label { Text = $"{stars}  ·  {authorName}", FontSize = 13, TextColor = Color.FromArgb("#FFA000") },
                                new Label
                                {
                                    Text = string.IsNullOrWhiteSpace(review.Text) ? "(No written comment)" : review.Text,
                                    FontSize = 14,
                                    TextColor = Color.FromArgb("#333333")
                                }
                            }
                        },
                        CreateReportReviewButton(review.Id)
                    }
                }
            };

            ReviewsList.Children.Add(card);
        }
    }

    /// <summary>Small flag-icon button placed on each review card; reports that specific review.</summary>
    private Button CreateReportReviewButton(string reviewId)
    {
        var button = new Button
        {
            Text = "🚩",
            FontSize = 14,
            BackgroundColor = Colors.Transparent,
            TextColor = Color.FromArgb("#999999"),
            Padding = 0,
            WidthRequest = 32,
            HeightRequest = 32,
            VerticalOptions = LayoutOptions.Start
        };
        button.Clicked += (s, e) => _ = ReportAsync("Review", reviewId);
        Grid.SetColumn(button, 1);
        return button;
    }

    /// <summary>
    /// Shared report flow for both a place and an individual review — asks for a
    /// reason via a native action sheet (falling back to a free-text prompt for
    /// "Other"), then files it. Login-gated the same way Save/Write a review are.
    /// </summary>
    private async Task ReportAsync(string targetType, string targetId)
    {
        if (!await _authService.IsLoggedInAsync())
        {
            await Shell.Current.GoToAsync(nameof(LoginPage));
            return;
        }

        var reason = await DisplayActionSheetAsync(
            "Why are you reporting this?",
            "Cancel",
            null,
            "Incorrect information",
            "Inappropriate content",
            "Spam or fake",
            "Permanently closed",
            "Other");

        if (string.IsNullOrWhiteSpace(reason) || reason == "Cancel") return;

        if (reason == "Other")
        {
            var detail = await DisplayPromptAsync("Report", "Briefly describe the issue:");
            if (string.IsNullOrWhiteSpace(detail)) return;
            reason = detail;
        }

        try
        {
            await _reportApi.CreateAsync(targetType, targetId, reason);
            await DisplayAlertAsync("Reported", "Thanks — we'll review this.", "OK");
        }
        catch (UnivastApiException ex)
        {
            await DisplayAlertAsync("Couldn't submit report", ex.Message, "OK");
        }
        catch (Exception)
        {
            await DisplayAlertAsync("Couldn't submit report", "Check your connection and try again.", "OK");
        }
    }

    private void ShowError()
    {
        ErrorLabel.IsVisible = true;
        ContentScroll.IsVisible = false;
    }

    private void Render(PlaceDto place)
    {
        Title = place.Name;
        NameLabel.Text = place.Name;
        CategoryLabel.Text = place.Category?.Name ?? "";

        RatingLabel.Text = place.RatingCount > 0
            ? $"★ {place.RatingAvg:0.0}  ({place.RatingCount} review{(place.RatingCount == 1 ? "" : "s")})"
            : "No ratings yet";

        if (place.DistanceMeters is double meters)
        {
            DistanceLabel.Text = meters >= 1000 ? $"{meters / 1000:0.0} km away" : $"{meters:0} m away";
            DistanceLabel.IsVisible = true;
        }

        if (!string.IsNullOrWhiteSpace(place.Description))
        {
            DescriptionLabel.Text = place.Description;
            DescriptionLabel.IsVisible = true;
        }

        if (!string.IsNullOrWhiteSpace(place.Address))
        {
            AddressLabel.Text = $"📍  {place.Address}";
            AddressLabel.IsVisible = true;
        }

        if (!string.IsNullOrWhiteSpace(place.Phone))
        {
            PhoneLabel.Text = $"📞  {place.Phone}";
            PhoneLabel.IsVisible = true;
            CallButton.IsVisible = true;
        }

        if (!string.IsNullOrWhiteSpace(place.Website))
        {
            WebsiteLabel.Text = $"🌐  {place.Website}";
            WebsiteLabel.IsVisible = true;
        }

        // Only places migrated from the campus nav graph (Phase 1) have this set —
        // see Models/DiscoveryDtos.cs. Everything else is general discovery-only.
        NavigateCampusButton.IsVisible = !string.IsNullOrWhiteSpace(place.SourceCampusId);

        UpdateSaveButton();
        ContentScroll.IsVisible = true;
    }

    private void UpdateSaveButton()
    {
        if (_place == null) return;
        var saved = LocalFavoritesStore.IsFavorite(_place.Id);
        SaveButton.Text = saved ? "★  Saved" : "☆  Save";
    }

    private async void Directions_Clicked(object sender, EventArgs e)
    {
        if (_place == null) return;

        try
        {
            var location = new Location(_place.Location.Latitude, _place.Location.Longitude);
            await Map.OpenAsync(location, new MapLaunchOptions { Name = _place.Name });
        }
        catch (Exception ex)
        {
            await DisplayAlertAsync("Couldn't open maps", ex.Message, "OK");
        }
    }

    private async void Call_Clicked(object sender, EventArgs e)
    {
        if (_place?.Phone is not { Length: > 0 } phone) return;

        try
        {
            PhoneDialer.Default.Open(phone);
        }
        catch (Exception ex)
        {
            await DisplayAlertAsync("Couldn't place call", ex.Message, "OK");
        }
    }

    private async void Save_Clicked(object sender, EventArgs e)
    {
        if (_place == null) return;

        // Favorites require an account (so they can eventually sync across devices
        // once a real Favorite API exists — see LocalFavoritesStore). Gate here.
        if (!await _authService.IsLoggedInAsync())
        {
            await Shell.Current.GoToAsync(nameof(LoginPage));
            return;
        }

        LocalFavoritesStore.Toggle(_place.Id);
        UpdateSaveButton();
    }

    private async void WriteReview_Clicked(object sender, EventArgs e)
    {
        if (_place == null) return;

        if (!await _authService.IsLoggedInAsync())
        {
            await Shell.Current.GoToAsync(nameof(LoginPage));
            return;
        }

        await Shell.Current.GoToAsync($"{nameof(WriteReviewPage)}?placeId={Uri.EscapeDataString(_place.Id)}");
    }

    private async void ClaimBusiness_Clicked(object sender, EventArgs e)
    {
        if (_place == null) return;

        if (!await _authService.IsLoggedInAsync())
        {
            await Shell.Current.GoToAsync(nameof(LoginPage));
            return;
        }

        await Shell.Current.GoToAsync($"{nameof(ClaimBusinessPage)}?placeId={Uri.EscapeDataString(_place.Id)}");
    }

    private void ReportPlace_Clicked(object sender, EventArgs e)
    {
        if (_place == null) return;
        _ = ReportAsync("Place", _place.Id);
    }

    private async void NavigateCampus_Clicked(object sender, EventArgs e)
    {
        if (string.IsNullOrWhiteSpace(_place?.SourceCampusId)) return;
        await Shell.Current.GoToAsync($"{nameof(RoutePage)}?campusId={Uri.EscapeDataString(_place.SourceCampusId)}");
    }
}
