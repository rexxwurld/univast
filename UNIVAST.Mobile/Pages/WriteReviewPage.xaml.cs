using UNIVAST.Mobile.Services;

namespace UNIVAST.Mobile.Pages;

[QueryProperty(nameof(PlaceId), "placeId")]
public partial class WriteReviewPage : ContentPage
{
    private readonly ReviewsApiService _reviewsApi;
    private int _selectedRating;
    private Button[] _stars = Array.Empty<Button>();

    public string PlaceId { get; set; } = "";

    public WriteReviewPage(ReviewsApiService reviewsApi)
    {
        InitializeComponent();
        _reviewsApi = reviewsApi;
    }

    protected override void OnAppearing()
    {
        base.OnAppearing();
        _stars = new[] { Star1, Star2, Star3, Star4, Star5 };
    }

    private void Star1_Clicked(object sender, EventArgs e) => SetRating(1);
    private void Star2_Clicked(object sender, EventArgs e) => SetRating(2);
    private void Star3_Clicked(object sender, EventArgs e) => SetRating(3);
    private void Star4_Clicked(object sender, EventArgs e) => SetRating(4);
    private void Star5_Clicked(object sender, EventArgs e) => SetRating(5);

    private void SetRating(int rating)
    {
        _selectedRating = rating;
        for (int i = 0; i < _stars.Length; i++)
        {
            _stars[i].Text = i < rating ? "★" : "☆";
        }
        ErrorLabel.IsVisible = false;
    }

    private async void Submit_Clicked(object sender, EventArgs e)
    {
        if (_selectedRating < 1)
        {
            ShowError("Tap a star to choose a rating.");
            return;
        }

        SetBusy(true);
        try
        {
            await _reviewsApi.CreateAsync(PlaceId, _selectedRating, TextEditor.Text ?? "");
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
        SubmitButton.IsEnabled = !busy;
        LoadingIndicator.IsRunning = busy;
        LoadingIndicator.IsVisible = busy;
    }
}
