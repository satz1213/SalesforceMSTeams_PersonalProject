/**
 * Shared, in-memory usage counters for a Case's swarm chat session, keyed by Case Id.
 *
 * caseSwarmChatCore and caseSwarm are sibling LWCs (not parent/child) placed independently
 * on the page, so they can't call each other's methods directly. Rather than round-tripping
 * through Lightning Message Service pub/sub (which only works if a listener happens to be
 * mounted at the moment of the request), this is a plain ES module - LWC modules are
 * singletons per page load, so both components importing this file share the same Map.
 *
 * Counts are approximate by design (see AskUserQuestion tradeoff this was built against):
 * they reflect what this one browser tab observed, not an authoritative Azure/Graph-side
 * audit trail. They reset if the tab is closed/reloaded before "Clear swarm data" is clicked.
 */
const usageByCaseId = new Map();

function getOrCreate(caseId) {
    if (!usageByCaseId.has(caseId)) {
        usageByCaseId.set(caseId, {
            historyPollCount: 0,
            sendCount: 0,
            rateLimitedCount: 0,
            apexFallbackCount: 0,
            sessionStartedAt: null
        });
    }
    return usageByCaseId.get(caseId);
}

function markSessionStarted(usage) {
    if (!usage.sessionStartedAt) {
        usage.sessionStartedAt = new Date().toISOString();
    }
}

export function recordHistoryPoll(caseId) {
    const usage = getOrCreate(caseId);
    usage.historyPollCount += 1;
    markSessionStarted(usage);
}

export function recordSend(caseId) {
    const usage = getOrCreate(caseId);
    usage.sendCount += 1;
    markSessionStarted(usage);
}

export function recordRateLimited(caseId) {
    const usage = getOrCreate(caseId);
    usage.rateLimitedCount += 1;
    markSessionStarted(usage);
}

export function recordApexFallback(caseId) {
    const usage = getOrCreate(caseId);
    usage.apexFallbackCount += 1;
    markSessionStarted(usage);
}

export function getUsageSnapshot(caseId) {
    return { ...getOrCreate(caseId) };
}

export function clearUsage(caseId) {
    usageByCaseId.delete(caseId);
}
