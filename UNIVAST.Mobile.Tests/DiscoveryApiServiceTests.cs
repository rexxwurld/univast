using System.Globalization;
using System.Net;
using UNIVAST.Mobile.Models;
using UNIVAST.Mobile.Services;

namespace UNIVAST.Mobile.Tests;

public class DiscoveryApiServiceTests
{
    private static (DiscoveryApiService Service, StubHandler Handler) Create(
        Func<HttpRequestMessage, string?, HttpResponseMessage> respond)
    {
        var handler = new StubHandler(respond);
        var http = new HttpClient(handler) { BaseAddress = new Uri("https://api.test/") };
        return (new DiscoveryApiService(http), handler);
    }

    [Fact]
    public async Task CreatePlace_omits_optional_fields_that_are_null()
    {
        var (service, handler) = Create((_, _) =>
            Responses.Json(HttpStatusCode.Created, "{\"_id\":\"p1\",\"name\":\"Cafe\"}"));

        var place = await service.CreatePlaceAsync(new CreatePlaceRequest
        {
            Name = "Cafe",
            Category = "c1",
            Latitude = 4.95,
            Longitude = 8.33,
            Phone = "0800",
        });

        Assert.Equal("p1", place.Id);
        var call = handler.Calls.Single();
        Assert.Equal(HttpMethod.Post, call.Request.Method);
        Assert.EndsWith("api/v1/places", call.Request.RequestUri!.AbsolutePath);
        Assert.Contains("\"name\":\"Cafe\"", call.Body);
        Assert.Contains("\"phone\":\"0800\"", call.Body);
        // The backend's zod schema rejects null strings, so these keys must be absent entirely.
        Assert.DoesNotContain("description", call.Body);
        Assert.DoesNotContain("website", call.Body);
        Assert.DoesNotContain("photos", call.Body);
        Assert.DoesNotContain("null", call.Body);
    }

    [Fact]
    public async Task CreatePlace_surfaces_the_backend_validation_message()
    {
        var (service, _) = Create((_, _) =>
            Responses.Json(HttpStatusCode.BadRequest, "{\"message\":\"website must start with http:// or https://\"}"));

        var ex = await Assert.ThrowsAsync<UnivastApiException>(() =>
            service.CreatePlaceAsync(new CreatePlaceRequest { Name = "x", Category = "c" }));

        Assert.Equal(400, ex.StatusCode);
        Assert.Contains("website", ex.Message);
    }

    [Fact]
    public async Task ReverseGeocode_returns_the_display_name()
    {
        var (service, _) = Create((_, _) =>
            Responses.Json(HttpStatusCode.OK, "{\"displayName\":\"Calabar, Nigeria\",\"address\":{}}"));

        Assert.Equal("Calabar, Nigeria", await service.ReverseGeocodeAsync(4.95, 8.33));
    }

    [Fact]
    public async Task ReverseGeocode_returns_null_when_no_address_exists()
    {
        var (service, _) = Create((_, _) => Responses.Json(HttpStatusCode.NotFound, "{\"message\":\"No address found\"}"));

        Assert.Null(await service.ReverseGeocodeAsync(0, 0));
    }

    [Fact]
    public async Task ReverseGeocode_still_throws_on_real_errors()
    {
        var (service, _) = Create((_, _) => Responses.Json(HttpStatusCode.BadGateway, "{\"message\":\"Reverse geocoding failed\"}"));

        await Assert.ThrowsAsync<UnivastApiException>(() => service.ReverseGeocodeAsync(4.95, 8.33));
    }

    [Fact]
    public async Task UploadImage_sends_a_multipart_form_and_returns_the_url()
    {
        var (service, handler) = Create((_, _) =>
            Responses.Json(HttpStatusCode.Created, "{\"url\":\"https://img.test/a.jpg\",\"publicId\":\"univast/a\"}"));

        using var stream = new MemoryStream(new byte[] { 1, 2, 3 });
        var url = await service.UploadImageAsync(stream, "a.jpg", "image/jpeg");

        Assert.Equal("https://img.test/a.jpg", url);
        var call = handler.Calls.Single();
        Assert.Equal("multipart/form-data", call.Request.Content!.Headers.ContentType!.MediaType);
        Assert.Contains("image", call.Body);
        Assert.Contains("a.jpg", call.Body);
    }

    [Fact]
    public async Task GetNearby_formats_coordinates_with_the_invariant_culture()
    {
        var commaCulture = (CultureInfo)CultureInfo.InvariantCulture.Clone();
        commaCulture.NumberFormat.NumberDecimalSeparator = ",";

        var original = CultureInfo.CurrentCulture;
        CultureInfo.CurrentCulture = commaCulture;
        try
        {
            var (service, handler) = Create((_, _) =>
                Responses.Json(HttpStatusCode.OK, "{\"data\":[],\"pagination\":{}}"));

            await service.GetNearbyAsync(4.95, 8.33, 1500);

            var query = handler.Calls.Single().Request.RequestUri!.Query;
            Assert.Contains("lat=4.95", query);
            Assert.Contains("lng=8.33", query);
            Assert.Contains("radius=1500", query);
        }
        finally
        {
            CultureInfo.CurrentCulture = original;
        }
    }

    [Fact]
    public async Task GetNearby_adds_category_and_text_filters_escaped()
    {
        var (service, handler) = Create((_, _) => Responses.Json(HttpStatusCode.OK, "{\"data\":[],\"pagination\":{}}"));

        await service.GetNearbyAsync(1, 2, 3000, categoryId: "abc123", query: "fried rice & beans");

        var query = handler.Calls.Single().Request.RequestUri!.Query;
        Assert.Contains("category=abc123", query);
        Assert.Contains("q=fried%20rice%20%26%20beans", query);
    }
}
