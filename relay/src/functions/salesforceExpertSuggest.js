/**
 * Schedule Expert Call AI suggestion endpoint - the only relay function calling an LLM, so the
 * only one holding a real secret (Azure OpenAI key). Takes case text + Expert__c candidates
 * (fetched client-side, per-user); returns ranked time-slot suggestions. Never touches Salesforce.
 * Prototype only - no real calendar/meeting is created.
 *
 * Settings: AZURE_OPENAI_ENDPOINT, AZURE_OPENAI_API_KEY, AZURE_OPENAI_DEPLOYMENT (currently
 * gpt-5-nano-1, switched from gpt-4.1-mini-1 for cost - see salesforceAiChat.js's header comment
 * for the full explanation; same fix applied here: reasoning.effort: 'minimal' and a bigger
 * max_output_tokens, since gpt-5-nano's reasoning tokens count against that same budget and can
 * otherwise silently consume all of it before any visible output is produced. temperature is
 * deliberately never sent - GPT-5-family models reject it outright.
 *
 * Uses the Responses API (POST {endpoint}/openai/v1/responses), not Chat Completions: model name
 * goes in the body, no api-version param, api-key header, response is output[].content[].text.
 */
const { app } = require('@azure/functions');

const MAX_CASE_TEXT_LENGTH = 4000; // defensive cap - this is a prompt input, not stored anywhere
const MAX_EXPERTS = 25;

// Manual walk of the Responses API shape (no SDK - stays dependency-free).
function extractResponsesText(data) {
    if (!data || !Array.isArray(data.output)) return null;
    for (var i = 0; i < data.output.length; i++) {
        var item = data.output[i];
        if (item.type !== 'message' || !Array.isArray(item.content)) continue;
        for (var j = 0; j < item.content.length; j++) {
            if (item.content[j].type === 'output_text' && item.content[j].text) {
                return item.content[j].text;
            }
        }
    }
    return null;
}

function extractJson(content) {
    // Strip markdown fences (models add them sometimes), then try a straight parse, then fall
    // back to grabbing the first {...} block.
    var trimmed = (content || '').trim().replace(/^```(?:json)?/i, '').replace(/```$/, '').trim();
    try {
        return JSON.parse(trimmed);
    } catch (e) {
        var match = trimmed.match(/\{[\s\S]*\}/);
        if (match) {
            try { return JSON.parse(match[0]); } catch (e2) { /* fall through */ }
        }
        return null;
    }
}

app.http('salesforceExpertSuggest', {
    methods: ['POST'],
    authLevel: 'anonymous',
    handler: async (request, context) => {
        var endpoint = process.env.AZURE_OPENAI_ENDPOINT;
        var apiKey = process.env.AZURE_OPENAI_API_KEY;
        var deployment = process.env.AZURE_OPENAI_DEPLOYMENT;
        if (!endpoint || !apiKey || !deployment) {
            context.error('AZURE_OPENAI_* app settings are not configured.');
            return { status: 500, jsonBody: { error: 'Expert suggestion is not configured on the relay yet.' } };
        }

        var body;
        try {
            body = await request.json();
        } catch (e) {
            return { status: 400, jsonBody: { error: 'Invalid JSON body.' } };
        }

        var caseText = ((body && body.caseText) || '').toString().slice(0, MAX_CASE_TEXT_LENGTH);
        var experts = Array.isArray(body && body.experts) ? body.experts.slice(0, MAX_EXPERTS) : [];
        if (!caseText || !experts.length) {
            return { status: 400, jsonBody: { error: 'caseText and experts are required.' } };
        }

        var candidateList = experts.map(function (e, i) {
            return (i + 1) + '. ' + (e.name || 'Unknown') +
                ' | Topics: ' + (e.topic || 'n/a') +
                ' | Bio: ' + (e.bio || 'n/a') +
                ' | Available slots: ' + (e.slots || 'n/a');
        }).join('\n');

        var systemPrompt = 'You help a support agent schedule a call with the best-matching expert ' +
            'for a case. You are given the case details and a numbered list of candidate experts ' +
            'with their topics, bio, and available time slots (each expert may list more than one ' +
            'slot). Propose up to 3 ranked time-slot options overall, best first - these can be ' +
            'different slots from the SAME expert if they are clearly the best match, or from ' +
            'different experts. Each option\'s "name" must exactly match that expert\'s name from the ' +
            'candidate list, verbatim, unchanged - the client looks the real record up by that exact ' +
            'string. Each option must use one of that expert\'s listed slots verbatim, ' +
            'unchanged. Also write a one-sentence summary explaining ONLY why the top pick is the ' +
            'right expert for this case (their matching topic/skill) - the day and time are already ' +
            'shown separately in the schedule, so never mention or restate any specific day, time, ' +
            'or slot text in the summary itself. Do not invent facts not in the case/expert data. ' +
            'If none of the candidates are a good match, return an empty options array and say so ' +
            'plainly in the summary. Respond with ONLY strict JSON, no markdown fences, no ' +
            'commentary, in exactly this shape: ' +
            '{"summary":"...","options":[{"name":"...","slot":"...","isBestMatch":true}]}';

        var userPrompt = 'Case details:\n' + caseText + '\n\nCandidate experts:\n' + candidateList;

        try {
            var url = endpoint.replace(/\/$/, '') + '/openai/v1/responses';
            var res = await fetch(url, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json', 'api-key': apiKey },
                body: JSON.stringify({
                    model: deployment,
                    instructions: systemPrompt,
                    input: userPrompt,
                    max_output_tokens: 900,
                    reasoning: { effort: 'minimal' }
                })
            });
            var data = await res.json();
            if (!res.ok) {
                context.error('Azure OpenAI request failed:', JSON.stringify(data));
                return { status: 502, jsonBody: { error: 'Could not reach the AI suggestion service.' } };
            }
            var content = extractResponsesText(data);
            var parsed = extractJson(content);
            if (!parsed || !Array.isArray(parsed.options)) {
                context.error('AI response was not the expected JSON shape:', content);
                return { status: 502, jsonBody: { error: 'The AI suggestion service returned an unexpected response.' } };
            }
            return {
                status: 200,
                headers: { 'Content-Type': 'application/json' },
                jsonBody: { summary: parsed.summary || '', options: parsed.options }
            };
        } catch (err) {
            context.error('Failed to call Azure OpenAI:', err);
            return { status: 502, jsonBody: { error: 'Could not reach the AI suggestion service.' } };
        }
    }
});
