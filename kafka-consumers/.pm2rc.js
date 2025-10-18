module.exports = {
    // Disable metrics collection to avoid wmic errors on Windows 11
    metrics: false,
    // Disable event loop monitoring
    event_loop_monitor: false,
    // Use fallback for pidusage
    pidusage_fallback: true
};