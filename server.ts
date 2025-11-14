import express, { Request, Response, NextFunction } from 'express';
import { createProxyMiddleware } from 'http-proxy-middleware';
import cors from 'cors';
import { ServerResponse } from 'http';
import './db/init';
import { logRequest, getOrCreateSession, updateSessionCount, getRequests, getUniqueEndpoints, getEndpointRequests } from './logger';
import { randomBytes } from 'crypto';
import { extractShape, analyzeEndpointDiffs } from './diff/analyzer';

const PORT = 9000;
const TARGET_URL = 'http://localhost:3002';

// Session management
const CURRENT_SESSION_ID = randomBytes(16).toString('hex');
getOrCreateSession(CURRENT_SESSION_ID, `Session ${new Date().toISOString()}`);
console.log(`[SESSION] Active session: ${CURRENT_SESSION_ID}`);

const app = express();

app.use(cors());
app.use(express.json({ limit: '10mb' }));
app.use(express.text({ limit: '10mb' }));
app.use(express.raw({ limit: '10mb' }));

// Request metadata storage
interface RequestMetadata {
    startTime: number;
    method: string;
    path: string;
    requestHeaders: Record<string, string | string[]>;
    requestBody: any;
}

const requestMetadataMap = new Map<string, RequestMetadata>();

// Middleware to capture request metadata
app.use((req: Request, res: Response, next: NextFunction) => {
    const requestId = `${Date.now()}-${Math.random()}`;

    // Capture request body
    let requestBody = '';
    if (req.body) {
        requestBody = typeof req.body === 'string' ? req.body : JSON.stringify(req.body);
    }

    const metadata: RequestMetadata = {
        startTime: Date.now(),
        method: req.method,
        path: req.url,
        requestHeaders: req.headers as Record<string, string | string[]>,
        requestBody
    };

    requestMetadataMap.set(requestId, metadata);
    (req as any).requestId = requestId;

    next();
});

// API Routes (must be before proxy middleware)
app.get('/api/requests', (req: Request, res: Response) => {
    try {
        const { method, path, status, session } = req.query;

        const filters: any = {};

        if (method && typeof method === 'string') {
            filters.method = method;
        }

        if (path && typeof path === 'string') {
            filters.path = path;
        }

        if (status) {
            filters.statusCode = parseInt(status as string, 10);
        }

        if (session && typeof session === 'string') {
            filters.sessionId = session;
        }

        const requests = getRequests(filters);

        res.json({
            success: true,
            count: requests.length,
            data: requests
        });
    } catch (error) {
        console.error('[API] Error fetching requests:', error);
        res.status(500).json({
            success: false,
            error: 'Failed to fetch requests',
            message: error instanceof Error ? error.message : 'Unknown error'
        });
    }
});

// Get diff analysis for all endpoints
app.get('/api/diffs', (req: Request, res: Response) => {
    try {
        // Get all unique endpoints from the database
        const endpoints = getUniqueEndpoints();
        const diffs: any[] = [];

        for (const endpoint of endpoints) {
            // Get recent requests for this endpoint
            const requests = getEndpointRequests(endpoint.method, endpoint.path, 100);

            // Build GroupedEndpoint structure for analysis
            const shapes: any[] = [];
            requests.forEach(req => {
                if (req.responseBody && req.statusCode >= 200 && req.statusCode < 300) {
                    try {
                        const parsed = JSON.parse(req.responseBody);
                        const shape = extractShape(parsed);
                        shapes.push(shape);
                    } catch (e) {
                        // Skip non-JSON responses
                    }
                }
            });

            // Only analyze if we have multiple shapes to compare
            if (shapes.length > 1) {
                const groupedEndpoint = {
                    method: endpoint.method,
                    path: endpoint.path,
                    requestCount: endpoint.count,
                    shapes,
                    firstSeen: requests[requests.length - 1]?.timestamp || Date.now(),
                    lastSeen: requests[0]?.timestamp || Date.now(),
                    statusCodes: [...new Set(requests.map(r => r.statusCode))],
                    avgDuration: 0
                };

                const analysis = analyzeEndpointDiffs(groupedEndpoint);

                // Only include if there are inconsistencies
                if (analysis.inconsistencies.length > 0) {
                    // Parse inconsistencies into structured format
                    const missingFields: any[] = [];
                    const typeChanges: any[] = [];
                    const extraFields: any[] = [];

                    analysis.inconsistencies.forEach(msg => {
                        if (msg.includes('missing in')) {
                            const match = msg.match(/field '([^']+)' missing in/);
                            if (match) {
                                missingFields.push({
                                    field: match[1],
                                    path: match[1],
                                    type: 'missing'
                                });
                            }
                        } else if (msg.includes('has inconsistent types')) {
                            const match = msg.match(/field '([^']+)' has inconsistent types: (.+)/);
                            if (match) {
                                const types = match[2].split(', ');
                                typeChanges.push({
                                    field: match[1],
                                    path: match[1],
                                    type: 'type_change',
                                    expectedType: types[0],
                                    actualType: types.slice(1).join(', ')
                                });
                            }
                        }
                    });

                    diffs.push({
                        method: endpoint.method,
                        path: endpoint.path,
                        totalResponses: shapes.length,
                        inconsistencies: {
                            missingFields,
                            typeChanges,
                            extraFields
                        },
                        baseShape: shapes[0] || {},
                        variantShapes: shapes.slice(1)
                    });
                }
            }
        }

        res.json({
            success: true,
            count: diffs.length,
            data: diffs
        });
    } catch (error) {
        console.error('[API] Error analyzing diffs:', error);
        res.status(500).json({
            success: false,
            error: 'Failed to analyze endpoint diffs',
            message: error instanceof Error ? error.message : 'Unknown error'
        });
    }
});

// Get latency statistics for all endpoints
app.get('/api/stats/latency', (req: Request, res: Response) => {
    try {
        const endpoints = getUniqueEndpoints();
        const latencyStats = endpoints.map(endpoint => {
            const requests = getEndpointRequests(endpoint.method, endpoint.path, 1000);

            // Filter requests with valid duration
            const validRequests = requests.filter(r => r.durationMs !== null && r.durationMs !== undefined);

            if (validRequests.length === 0) {
                return null;
            }

            const latencies = validRequests.map(r => r.durationMs as number);
            const avgLatency = latencies.reduce((sum, lat) => sum + lat, 0) / latencies.length;
            const minLatency = Math.min(...latencies);
            const maxLatency = Math.max(...latencies);

            return {
                endpoint: `${endpoint.method} ${endpoint.path}`,
                method: endpoint.method,
                path: endpoint.path,
                avgLatency,
                minLatency,
                maxLatency,
                count: validRequests.length
            };
        }).filter(stat => stat !== null);

        res.json({
            success: true,
            count: latencyStats.length,
            data: latencyStats
        });
    } catch (error) {
        console.error('[API] Error fetching latency stats:', error);
        res.status(500).json({
            success: false,
            error: 'Failed to fetch latency statistics',
            message: error instanceof Error ? error.message : 'Unknown error'
        });
    }
});

// Proxy middleware with logging
const proxyMiddleware = createProxyMiddleware({
    target: TARGET_URL,
    changeOrigin: true,
    selfHandleResponse: true, // We manually handle the response to capture it for logging
    on: {
        proxyReq: (proxyReq, req) => {
            const requestId = (req as any).requestId;
            const metadata = requestMetadataMap.get(requestId);

            if (metadata) {
                console.log(`[PROXY] ${metadata.method} ${metadata.path} -> ${TARGET_URL}${metadata.path}`);

                // If request has a body, write it to the proxy request
                if (metadata.requestBody && metadata.requestBody.length > 0) {
                    const bodyData = Buffer.from(metadata.requestBody, 'utf8');
                    proxyReq.setHeader('Content-Length', bodyData.length);
                    proxyReq.write(bodyData);
                    proxyReq.end();
                }
            }
        },
        proxyRes: (proxyRes, req, res) => {
            const requestId = (req as any).requestId;
            const metadata = requestMetadataMap.get(requestId);

            if (metadata) {
                const duration = Date.now() - metadata.startTime;
                console.log(`[RESPONSE] ${metadata.method} ${metadata.path} - ${proxyRes.statusCode} - ${duration}ms`);

                // Forward status code and headers to client
                res.statusCode = proxyRes.statusCode || 200;
                Object.keys(proxyRes.headers).forEach(key => {
                    const value = proxyRes.headers[key];
                    if (value !== undefined) {
                        res.setHeader(key, value);
                    }
                });

                // Capture response body while piping to client
                const chunks: Buffer[] = [];

                proxyRes.on('data', (chunk: Buffer) => {
                    chunks.push(chunk);
                    res.write(chunk); // Pipe to client
                });

                proxyRes.on('end', () => {
                    const responseBody = Buffer.concat(chunks).toString('utf8');

                    // Log to database
                    logRequest({
                        sessionId: CURRENT_SESSION_ID,
                        method: metadata.method,
                        path: metadata.path,
                        statusCode: proxyRes.statusCode,
                        durationMs: duration,
                        requestHeaders: metadata.requestHeaders,
                        requestBody: metadata.requestBody,
                        responseHeaders: proxyRes.headers as Record<string, string | string[]>,
                        responseBody,
                        timestamp: metadata.startTime
                    });

                    updateSessionCount(CURRENT_SESSION_ID);

                    res.end(); // End client response
                });

                // Cleanup metadata
                requestMetadataMap.delete(requestId);
            } else {
                // No metadata - just proxy through
                res.statusCode = proxyRes.statusCode || 200;
                Object.keys(proxyRes.headers).forEach(key => {
                    const value = proxyRes.headers[key];
                    if (value !== undefined) {
                        res.setHeader(key, value);
                    }
                });
                proxyRes.pipe(res);
            }
        },
        error: (err, req, res) => {
            const requestId = (req as any).requestId;
            const metadata = requestMetadataMap.get(requestId);

            if (metadata) {
                const duration = Date.now() - metadata.startTime;
                console.error(`[ERROR] ${metadata.method} ${metadata.path}: ${err.message} - ${duration}ms`);

                // Log error to database
                logRequest({
                    sessionId: CURRENT_SESSION_ID,
                    method: metadata.method,
                    path: metadata.path,
                    durationMs: duration,
                    requestHeaders: metadata.requestHeaders,
                    requestBody: metadata.requestBody,
                    error: err.message,
                    timestamp: metadata.startTime
                });

                updateSessionCount(CURRENT_SESSION_ID);

                // Cleanup metadata
                requestMetadataMap.delete(requestId);
            }

            if (res && res instanceof ServerResponse && !res.headersSent) {
                res.statusCode = 502;
                res.setHeader('Content-Type', 'application/json');
                res.end(JSON.stringify({
                    error: 'Proxy Error',
                    message: 'Unable to reach backend server',
                    details: err.message
                }));
            }
        }
    }
});

// Proxy ALL requests to backend
app.use('/', proxyMiddleware);

app.listen(PORT, () => {
    console.log(`[SERVER] API Inspector running on http://localhost:${PORT}`);
    console.log(`[PROXY] Forwarding all requests to ${TARGET_URL}`);
});
