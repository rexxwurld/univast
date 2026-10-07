using System.Text.Json;
using UNIVAST.Mobile.Models;
using UNIVAST.Mobile.Services;

namespace UNIVAST.Mobile.Pages;

[QueryProperty(nameof(CampusId), "campusId")]
[QueryProperty(nameof(CampusName), "campusName")]
[QueryProperty(nameof(TargetModel), "targetModel")]
[QueryProperty(nameof(TargetId), "targetId")]
[QueryProperty(nameof(TargetName), "targetName")]
public partial class ContributionCenterPage : ContentPage
{
    private static readonly string[] TargetModels = ["Building", "Floor", "Room", "Entrance", "Landmark"];
    private readonly ContributionApiService _api;
    private IReadOnlyList<FileResult> _evidenceFiles = Array.Empty<FileResult>();
    private string? _resubmittingContributionId;
    private bool _loaded;

    public string CampusId { get; set; } = "";
    public string CampusName { get; set; } = "";
    public string TargetModel { get; set; } = "";
    public string TargetId { get; set; } = "";
    public string TargetName { get; set; } = "";

    public ContributionCenterPage(ContributionApiService api)
    {
        InitializeComponent();
        _api = api;
        TargetPicker.ItemsSource = TargetModels;
        TargetPicker.SelectedIndex = 0;
    }

    protected override async void OnAppearing()
    {
        base.OnAppearing();
        if (!_loaded)
        {
            _loaded = true;
            CampusTitle.Text = string.IsNullOrWhiteSpace(CampusName) ? "Suggest a campus correction" : $"Contribute to {CampusName}";
            TargetIdEntry.Text = TargetId;
            if (!string.IsNullOrWhiteSpace(TargetName)) TitleEntry.Text = $"Update {TargetName}";
            var targetIndex = Array.IndexOf(TargetModels, TargetModel);
            if (targetIndex >= 0) TargetPicker.SelectedIndex = targetIndex;
        }
        await LoadMineAsync();
    }

    private async void Submit_Clicked(object? sender, EventArgs e)
    {
        var title = TitleEntry.Text?.Trim() ?? "";
        var targetId = TargetIdEntry.Text?.Trim() ?? "";
        if (string.IsNullOrWhiteSpace(CampusId) || string.IsNullOrWhiteSpace(title) || targetId.Length != 24 || !targetId.All(Uri.IsHexDigit) || TargetPicker.SelectedIndex < 0)
        {
            SetError("Select a data type, enter a 24-character target ID, and add a title.");
            return;
        }

        Dictionary<string, JsonElement> changes;
        try
        {
            using var document = JsonDocument.Parse(ChangesEditor.Text ?? "");
            if (document.RootElement.ValueKind != JsonValueKind.Object || !document.RootElement.EnumerateObject().Any())
                throw new JsonException();
            changes = document.RootElement.EnumerateObject().ToDictionary(property => property.Name, property => property.Value.Clone());
        }
        catch (JsonException)
        {
            SetError("Enter a non-empty JSON object of proposed field changes.");
            return;
        }

        SetBusy(true);
        try
        {
            var request = new CreateContributionRequest
            {
                Title = title,
                Description = DescriptionEditor.Text?.Trim() ?? "",
                CampusId = CampusId,
                TargetModel = TargetModels[TargetPicker.SelectedIndex],
                TargetId = targetId,
                ProposedChanges = changes,
            };
            if (_evidenceFiles.Count > 0)
            {
                var uploaded = await _api.UploadEvidenceAsync(_evidenceFiles);
                request.EvidenceFileIds = uploaded.Select(file => file.Id).ToList();
            }
            if (_resubmittingContributionId is null)
                await _api.SubmitAsync(request);
            else
                await _api.ResubmitAsync(_resubmittingContributionId, request);
            _resubmittingContributionId = null;
            TitleEntry.Text = "";
            DescriptionEditor.Text = "";
            SubmitButton.Text = "Submit for review";
            _evidenceFiles = Array.Empty<FileResult>();
            EvidenceLabel.Text = "Optional: up to 5 photos, PDFs, or videos";
            SetError("Contribution submitted for review.", isError: false);
            await LoadMineAsync();
        }
        catch (Exception ex)
        {
            SetError(CampusErrorMapper.ToUserMessage(ex, "submit this contribution"));
        }
        finally
        {
            SetBusy(false);
        }
    }

    private async void Refresh_Clicked(object? sender, EventArgs e) => await LoadMineAsync();

    private async void Evidence_Clicked(object? sender, EventArgs e)
    {
        try
        {
            var files = (await FilePicker.Default.PickMultipleAsync(new PickOptions { PickerTitle = "Choose supporting evidence" }))?.Take(5).ToList();
            if (files is null) return;
            _evidenceFiles = files;
            EvidenceLabel.Text = files.Count == 0 ? "Optional: up to 5 photos, PDFs, or videos" : string.Join(", ", files.Select(file => file.FileName));
            ErrorLabel.IsVisible = false;
        }
        catch
        {
            SetError("Couldn't open the file picker.");
        }
    }

    private async Task LoadMineAsync()
    {
        try
        {
            var contributions = await _api.GetMineAsync();
            SubmissionsList.Children.Clear();
            foreach (var item in contributions)
            {
                var border = new Border
                {
                    Padding = 12,
                    Margin = new Thickness(0, 0, 0, 4),
                    Stroke = UvColors.Get("UvHairline"),
                    StrokeThickness = 1,
                    StrokeShape = new Microsoft.Maui.Controls.Shapes.RoundRectangle { CornerRadius = 8 },
                    Background = UvColors.Get("UvSurface"),
                    Content = new VerticalStackLayout
                    {
                        Spacing = 3,
                        Children =
                        {
                            new Label { Text = item.Title, FontAttributes = FontAttributes.Bold, TextColor = UvColors.Get("UvText") },
                            new Label { Text = $"{item.TargetModel} · {item.Status}", FontSize = 12, TextColor = StatusColor(item.Status) },
                            new Label { Text = string.IsNullOrWhiteSpace(item.ReviewNotes) ? (item.RewardPoints > 0 ? $"Reward: {item.RewardPoints} points" : "") : item.ReviewNotes, FontSize = 12, TextColor = UvColors.Get("UvMuted") },
                        },
                    },
                };
                if (item.Status == "CHANGES_REQUESTED")
                {
                    ((VerticalStackLayout)border.Content).Children.Add(new Button
                    {
                        Text = "Edit and resubmit",
                        HorizontalOptions = LayoutOptions.Start,
                        FontSize = 12,
                        Command = new Command(() => EditForResubmission(item)),
                    });
                }
                SubmissionsList.Children.Add(border);
            }
        }
        catch (Exception ex)
        {
            SetError(CampusErrorMapper.ToUserMessage(ex, "load your submissions"));
        }
    }

    private void EditForResubmission(ContributionDto item)
    {
        _resubmittingContributionId = item.Id;
        TargetIdEntry.Text = item.TargetId;
        var targetIndex = Array.IndexOf(TargetModels, item.TargetModel);
        if (targetIndex >= 0) TargetPicker.SelectedIndex = targetIndex;
        TitleEntry.Text = item.Title;
        DescriptionEditor.Text = item.Description;
        ChangesEditor.Text = JsonSerializer.Serialize(item.ProposedChanges);
        SubmitButton.Text = "Resubmit for review";
        SetError(string.IsNullOrWhiteSpace(item.ReviewNotes) ? "Update the proposed changes, then resubmit." : item.ReviewNotes, isError: false);
    }

    /// <summary>Status colour carries meaning only: approved = success, rejected = error, everything else neutral.</summary>
    private static Color StatusColor(string? status) => status switch
    {
        "APPROVED" => UvColors.Get("UvSuccess"),
        "REJECTED" => UvColors.Get("UvDanger"),
        _ => UvColors.Get("UvMuted"),
    };

    private void SetError(string message, bool isError = true)
    {
        ErrorLabel.Text = message;
        ErrorLabel.TextColor = isError ? UvColors.Get("UvDanger") : UvColors.Get("UvMuted");
        ErrorLabel.IsVisible = true;
    }

    private void SetBusy(bool busy)
    {
        SubmitButton.IsEnabled = !busy;
        BusyIndicator.IsVisible = BusyIndicator.IsRunning = busy;
    }
}