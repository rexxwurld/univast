using UNIVAST.Mobile.Models;

namespace UNIVAST.Mobile.Services;

/// <summary>
/// Test-only stand-in for the MAUI CampusPackStore (SQLite + FileSystem.AppDataDirectory can't be
/// linked into this plain net10.0 project). It lets the linked CampusPackManager compile; nothing is persisted.
/// </summary>
public sealed class CampusPackStore
{
    public static Task<CampusPackInstallResult> InstallAsync(string campusId, CampusPackDto pack, CancellationToken ct = default) =>
        Task.FromResult(new CampusPackInstallResult
        {
            CampusId = campusId,
            Version = pack.Version,
            Checksum = pack.Checksum ?? string.Empty,
            Installed = true,
            UpToDate = pack.UpToDate,
        });

    public static CampusPackDto? Load(string campusId) => null;
    public static bool Remove(string campusId) => false;
    public static IReadOnlyList<string> GetInstalledCampusIds() => Array.Empty<string>();
}
