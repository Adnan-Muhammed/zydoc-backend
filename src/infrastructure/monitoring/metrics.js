export const systemMetrics = {
    totalRequests: 0,
    failedRequests: 0,
    totalResponseTime: 0,
    averageResponseTime: 0,
    recentLogs: [], // array of { timestamp, message, type }
    
    addLog: (message, type = 'error') => {
        systemMetrics.recentLogs.unshift({ timestamp: new Date().toISOString(), message, type });
        if (systemMetrics.recentLogs.length > 50) {
            systemMetrics.recentLogs.pop();
        }
    }
};
