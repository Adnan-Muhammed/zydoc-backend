import { systemMetrics } from '../../infrastructure/monitoring/metrics.js';

export const performanceTracker = (req, res, next) => {
    const start = process.hrtime();
    
    res.on('finish', () => {
        const diff = process.hrtime(start);
        const timeInMs = (diff[0] * 1e3) + (diff[1] * 1e-6);
        
        systemMetrics.totalRequests++;
        systemMetrics.totalResponseTime += timeInMs;
        systemMetrics.averageResponseTime = systemMetrics.totalResponseTime / systemMetrics.totalRequests;
        
        if (res.statusCode >= 500) {
            systemMetrics.failedRequests++;
        }
    });
    
    next();
};
