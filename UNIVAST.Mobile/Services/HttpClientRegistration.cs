using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Http.Resilience;

namespace UNIVAST.Mobile.Services;

/// <summary>
/// One place that registers every typed API client with the same base address, auth
/// handler, and resilience policy (retry with backoff, per-attempt timeout, circuit
/// breaker) — instead of six copy-pasted AddHttpClient blocks in MauiProgram.
/// </summary>
public static class HttpClientRegistration
{
    public static IServiceCollection AddUnivastApiClients(this IServiceCollection services)
    {
        services.AddTransient<AuthHeaderHandler>();

        // Plain client for the token-refresh call: no auth handler (it would recurse).
        services.AddHttpClient(AuthHeaderHandler.RefreshClientName, ConfigureClient);

        services.AddApiClient<UnivastApiService>();
        services.AddApiClient<DiscoveryApiService>();
        services.AddApiClient<AuthService>();
        services.AddApiClient<ReviewsApiService>();
        services.AddApiClient<BusinessApiService>();
        services.AddApiClient<ReportApiService>();

        return services;
    }

    private static void AddApiClient<TClient>(this IServiceCollection services)
        where TClient : class
    {
        services
            .AddHttpClient<TClient>(ConfigureClient)
            // Order matters: the auth handler is outermost, so a 401 -> refresh -> retry
            // happens around (not inside) the resilience pipeline.
            .AddHttpMessageHandler<AuthHeaderHandler>()
            .AddStandardResilienceHandler(options =>
            {
                options.AttemptTimeout.Timeout = TimeSpan.FromSeconds(12);
                options.TotalRequestTimeout.Timeout = TimeSpan.FromSeconds(40);
                // The attempt timeout must be shorter than the circuit breaker's sampling window.
                options.CircuitBreaker.SamplingDuration = TimeSpan.FromSeconds(60);

                // Never auto-retry POST/PATCH/DELETE: a retried "create review" or
                // "submit report" whose first attempt actually reached the server would duplicate.
                options.Retry.DisableForUnsafeHttpMethods();
            });
    }

    private static void ConfigureClient(HttpClient client)
    {
        client.BaseAddress = new Uri(ApiConfig.BaseUrl);
        // Timeouts are owned by the resilience handler above.
        client.Timeout = Timeout.InfiniteTimeSpan;
    }
}
