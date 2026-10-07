using System.Security.Cryptography;
using System.Text;
using System.Text.Json;
using System.Text.Encodings.Web;
using SQLite;
using UNIVAST.Mobile.Models;

namespace UNIVAST.Mobile.Services;

/// <summary>
/// Local app-private cache for published campus packs. The store keeps the server
/// checksum and a canonical JSON representation so a local pack can be revalidated.
/// </summary>
public sealed class CampusPackStore
{
    private static readonly object Gate = new();
    private static SQLiteConnection? _db;
    private static readonly JsonWriterOptions CanonicalWriterOptions = new() { Encoder = JavaScriptEncoder.UnsafeRelaxedJsonEscaping };

    private const string DatabaseName = "univast_campus_packs.db3";
    private const int SupportedSchemaVersion = 1;

    public static async Task<CampusPackInstallResult> InstallAsync(string campusId, CampusPackDto pack, CancellationToken ct = default)
    {
        if (pack.SchemaVersion != SupportedSchemaVersion)
            throw new InvalidDataException($"Campus pack schema version {pack.SchemaVersion} is not supported.");
        if (pack.Version < 1 || pack.Snapshot.ValueKind != JsonValueKind.Object)
            throw new InvalidDataException("Campus pack payload is incomplete.");

        var payload = CanonicalJson(pack.Snapshot);
        var checksum = SHA256.HashData(Encoding.UTF8.GetBytes(payload));
        var expected = pack.Checksum?.Trim().ToLowerInvariant() ?? string.Empty;
        if (!string.Equals(expected, Convert.ToHexString(checksum).ToLowerInvariant(), StringComparison.OrdinalIgnoreCase))
        {
            throw new InvalidDataException("Campus pack checksum validation failed.");
        }

        await Task.Yield();
        ct.ThrowIfCancellationRequested();
        lock (Gate)
        {
            var db = Db();
            db.BeginTransaction();
            try
            {
                db.Execute("DELETE FROM campus_packs WHERE CampusId = ?", campusId);
                db.Insert(new CampusPackRecord
                {
                    CampusId = campusId,
                    Version = pack.Version,
                    SchemaVersion = pack.SchemaVersion,
                    Checksum = expected,
                    ContainsDevFixture = pack.ContainsDevFixture,
                    SizeBytes = Encoding.UTF8.GetByteCount(payload),
                    InstalledAtUtcTicks = DateTime.UtcNow.Ticks,
                    Json = payload,
                });
                db.Commit();
            }
            catch
            {
                db.Rollback();
                throw;
            }
        }

        return new CampusPackInstallResult
        {
            CampusId = campusId,
            Version = pack.Version,
            Checksum = expected,
            Installed = true,
            UpToDate = true,
        };
    }

    public static CampusPackDto? Load(string campusId)
    {
        try
        {
            lock (Gate)
            {
                var row = Db().Table<CampusPackRecord>().Where(r => r.CampusId == campusId).FirstOrDefault();
                if (row is null) return null;
                if (row.SchemaVersion != SupportedSchemaVersion) return null;
                var snapshot = JsonSerializer.Deserialize<JsonElement>(row.Json);
                var actualChecksum = Convert.ToHexString(SHA256.HashData(Encoding.UTF8.GetBytes(CanonicalJson(snapshot))));
                if (!string.Equals(actualChecksum, row.Checksum, StringComparison.OrdinalIgnoreCase))
                {
                    Db().Delete(row);
                    return null;
                }

                if (snapshot.ValueKind != JsonValueKind.Object) return null;
                return new CampusPackDto
                {
                    UpToDate = false,
                    Version = row.Version,
                    SchemaVersion = row.SchemaVersion,
                    Checksum = row.Checksum,
                    ContainsDevFixture = row.ContainsDevFixture,
                    PublishedAt = null,
                    Snapshot = snapshot,
                };
            }
        }
        catch (Exception)
        {
            return null;
        }
    }

    public static bool Remove(string campusId)
    {
        lock (Gate)
        {
            return Db().Delete<CampusPackRecord>(campusId) > 0;
        }
    }

    public static IReadOnlyList<string> GetInstalledCampusIds()
    {
        lock (Gate)
        {
            return Db().Table<CampusPackRecord>().ToList().Select(record => record.CampusId).ToList();
        }
    }

    private static SQLiteConnection Db()
    {
        if (_db is null)
        {
            var path = Path.Combine(FileSystem.AppDataDirectory, DatabaseName);
            _db = new SQLiteConnection(path);
            _db.CreateTable<CampusPackRecord>();
            if (!_db.GetTableInfo("campus_packs").Any(column => column.Name == nameof(CampusPackRecord.ContainsDevFixture)))
                _db.Execute("ALTER TABLE campus_packs ADD COLUMN ContainsDevFixture INTEGER NOT NULL DEFAULT 0");
        }

        return _db;
    }

    private static string CanonicalJson(JsonElement element)
    {
        using var stream = new MemoryStream();
        using (var writer = new Utf8JsonWriter(stream, CanonicalWriterOptions))
        {
            WriteCanonical(writer, element);
        }
        return Encoding.UTF8.GetString(stream.ToArray());
    }

    private static void WriteCanonical(Utf8JsonWriter writer, JsonElement element)
    {
        switch (element.ValueKind)
        {
            case JsonValueKind.Object:
                writer.WriteStartObject();
                foreach (var property in element.EnumerateObject().OrderBy(property => property.Name, StringComparer.Ordinal))
                {
                    writer.WritePropertyName(property.Name);
                    WriteCanonical(writer, property.Value);
                }
                writer.WriteEndObject();
                break;
            case JsonValueKind.Array:
                writer.WriteStartArray();
                foreach (var item in element.EnumerateArray()) WriteCanonical(writer, item);
                writer.WriteEndArray();
                break;
            default:
                element.WriteTo(writer);
                break;
        }
    }
}

[Table("campus_packs")]
public sealed class CampusPackRecord
{
    [PrimaryKey]
    public string CampusId { get; set; } = string.Empty;

    public int Version { get; set; }
    public int SchemaVersion { get; set; }
    public string Checksum { get; set; } = string.Empty;
    public bool ContainsDevFixture { get; set; }
    public long SizeBytes { get; set; }
    public long InstalledAtUtcTicks { get; set; }
    public string Json { get; set; } = string.Empty;
}
