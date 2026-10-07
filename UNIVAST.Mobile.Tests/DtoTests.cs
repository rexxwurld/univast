using System.Text.Json;
using UNIVAST.Mobile.Models;

namespace UNIVAST.Mobile.Tests;

public class DtoTests
{
    private static readonly JsonSerializerOptions Web = new(JsonSerializerDefaults.Web);

    [Fact]
    public void PlaceLocation_reads_GeoJSON_in_longitude_latitude_order()
    {
        var location = JsonSerializer.Deserialize<PlaceLocationDto>(
            "{\"type\":\"Point\",\"coordinates\":[8.33,4.95]}", Web)!;

        Assert.Equal(8.33, location.Longitude);
        Assert.Equal(4.95, location.Latitude);
    }

    [Fact]
    public void PlaceLocation_with_missing_coordinates_does_not_throw()
    {
        var location = new PlaceLocationDto { Coordinates = Array.Empty<double>() };

        Assert.Equal(0, location.Latitude);
        Assert.Equal(0, location.Longitude);
    }

    [Fact]
    public void AuthResponse_maps_token_refresh_token_and_user()
    {
        var auth = JsonSerializer.Deserialize<AuthResponse>(Responses.AuthJson("a", "r"), Web)!;

        Assert.Equal("a", auth.Token);
        Assert.Equal("r", auth.RefreshToken);
        Assert.Equal("ada@example.com", auth.User.Email);
        Assert.Equal("user", auth.User.Role);
    }

    [Fact]
    public void AuthResponse_tolerates_a_missing_refresh_token()
    {
        var auth = JsonSerializer.Deserialize<AuthResponse>(Responses.AuthJson("a", refresh: null), Web)!;

        Assert.Null(auth.RefreshToken);
    }
}
