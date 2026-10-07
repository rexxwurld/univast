using UNIVAST.Mobile.Models;
using UNIVAST.Mobile.Services;

namespace UNIVAST.Mobile.Tests;

public class GeneralMapSearchTests
{
    private static CampusSearchResultDto Hit(string kind, string id, string name, string? category = null, string? address = null) =>
        new() { Kind = kind, Id = id, Name = name, Category = category, Address = address, Latitude = 4.95, Longitude = 8.32 };

    [Fact]
    public void Geo_results_get_their_own_section_after_UNIVAST_results()
    {
        var response = new CampusSearchResponseDto
        {
            Results = new List<CampusSearchResultDto>
            {
                Hit("room", "r1", "LT1"),
                Hit("geo", "osm:node:1", "Calabar", "place", "Calabar, Cross River, Nigeria"),
            },
        };

        var sections = SearchResultGrouper.Group(response);

        Assert.Equal(new[] { "room", "geo" }, sections.Select(s => s.Kind).ToArray());
        Assert.Equal("MAP PLACES", sections[1].Title);
    }

    [Fact]
    public void A_geo_result_shows_its_address_as_the_subtitle()
    {
        var hit = Hit("geo", "osm:node:1", "Calabar", "place", "Calabar, Cross River, Nigeria");
        Assert.Equal("Calabar, Cross River, Nigeria", SearchResultGrouper.Subtitle(hit));
    }

    [Fact]
    public void A_geo_destination_keeps_its_coordinates_and_is_honest_that_directions_are_unavailable()
    {
        var detail = DestinationBuilder.FromSearchResult(Hit("geo", "osm:node:1", "Calabar"));

        Assert.Equal(4.95, detail.Latitude);
        Assert.Equal(8.32, detail.Longitude);
        Assert.False(detail.CanNavigate);
        Assert.Equal(DestinationBuilder.GeneralDirectionsUnavailable, detail.CannotNavigateReason);
    }
}
