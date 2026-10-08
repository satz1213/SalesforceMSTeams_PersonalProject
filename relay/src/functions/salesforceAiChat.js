/**
 * "Ask AI" chat endpoint for the record page - a second, narrower use of the same Azure OpenAI
 * resource as salesforceExpertSuggest.js (case summary + free-form Q&A about the open case and
 * the prototype Expert__c list, instead of a fixed ranked-suggestions shape). Same reasoning as
 * that file: the only relay function calling an LLM, so the only one holding a real secret.
 *
 * Settings: AZURE_OPENAI_ENDPOINT, AZURE_OPENAI_API_KEY, AZURE_OPENAI_DEPLOYMENT (currently
 * gpt-5-nano-1, switched from gpt-4.1-mini-1 for cost - see the reasoning-model notes below, this
 * needed real changes, not just a deployment-name swap).
 * Uses the Responses API (POST {endpoint}/openai/v1/responses) - case/expert context goes in
 * "instructions" (re-sent every turn, since it doesn't change), the running conversation goes in
 * "input" as an array of {role, content} turns - not the older Chat Completions shape.
 *
 * gpt-5-nano is a reasoning model: max_output_tokens caps hidden reasoning tokens AND the visible
 * answer TOGETHER, so a budget sized for a non-reasoning model (400, tuned for gpt-4.1-mini-1) can
 * get silently consumed entirely by reasoning, leaving zero tokens for the actual visible text -
 * extractResponsesText() then finds nothing and this reports "unexpected response", which is almost
 * certainly what "chat stopped working" after the model swap actually is. reasoning.effort:
 * 'minimal' keeps that overhead small (this is a short summary/Q&A task, not a task that benefits
 * from deep reasoning), and the token budget below is sized generously on top of that. temperature
 * is deliberately never sent - GPT-5-family models reject it outright (400 Bad Request). Both of
 * these are gpt-5-family-specific; remove reasoning.effort (and raise/lower max_output_tokens back
 * down) if this ever points at a non-reasoning model again.
 */
const { app } = require('@azure/functions');

const MAX_CASE_TEXT_LENGTH = 4000;
const MAX_EXPERTS = 25;
const MAX_HISTORY_TURNS = 20; // defensive cap - this is a prompt input, not stored anywhere

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

app.http('salesforceAiChat', {
    methods: ['POST'],
    authLevel: 'anonymous',
    handler: async (request, context) => {
        var endpoint = process.env.AZURE_OPENAI_ENDPOINT;
        var apiKey = process.env.AZURE_OPENAI_API_KEY;
        var deployment = process.env.AZURE_OPENAI_DEPLOYMENT;
        if (!endpoint || !apiKey || !deployment) {
            context.error('AZURE_OPENAI_* app settings are not configured.');
            return { status: 500, jsonBody: { error: 'Ask AI is not configured on the relay yet.' } };
        }

        var body;
        try {
            body = await request.json();
        } catch (e) {
            return { status: 400, jsonBody: { error: 'Invalid JSON body.' } };
        }

        var caseText = ((body && body.caseText) || '').toString().slice(0, MAX_CASE_TEXT_LENGTH);
        var experts = Array.isArray(body && body.experts) ? body.experts.slice(0, MAX_EXPERTS) : [];
        var history = Array.isArray(body && body.history) ? body.history.slice(-MAX_HISTORY_TURNS) : [];
        if (!history.length) {
            return { status: 400, jsonBody: { error: 'history is required.' } };
        }

        var candidateList = experts.map(function (e, i) {
            return (i + 1) + '. ' + (e.name || 'Unknown') +
                ' | Topics: ' + (e.topic || 'n/a') +
                ' | Bio: ' + (e.bio || 'n/a') +
                ' | Available slots: ' + (e.slots || 'n/a');
        }).join('\n');

        var instructions = 'You are a helpful assistant for a support agent working a Salesforce ' +
            'case inside Microsoft Teams. You can (1) summarize the case using only the case ' +
            'details given below, and (2) help find the right expert from the candidate list ' +
            'below, explaining why. Never invent case details, expert names, topics, or ' +
            'availability that isn\'t in the data given here. If asked something unrelated to this ' +
            'case or these experts, say plainly that you can only help with this case and these ' +
            'experts. Keep answers short (a few sentences), plain language, no markdown formatting ' +
            '- this renders in a plain chat bubble.\n\n' +
            'Case details:\n' + (caseText || '(none loaded)') + '\n\n' +
            'Candidate experts:\n' + (candidateList || '(none configured)');

        try {
            var url = endpoint.replace(/\/$/, '') + '/openai/v1/responses';
            var res = await fetch(url, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json', 'api-key': apiKey },
                body: JSON.stringify({
                    model: deployment,
                    instructions: instructions,
                    input: history,
                    max_output_tokens: 800,
                    reasoning: { effort: 'minimal' }
                })
            });
            var data = await res.json();
            if (!res.ok) {
                context.error('Azure OpenAI request failed:', JSON.stringify(data));
                return { status: 502, jsonBody: { error: 'Could not reach the AI assistant right now.' } };
            }
            var reply = extractResponsesText(data);
            if (!reply) {
                context.error('AI response had no text output:', JSON.stringify(data));
                return { status: 502, jsonBody: { error: 'The AI assistant returned an unexpected response.' } };
            }
            return {
                status: 200,
                headers: { 'Content-Type': 'application/json' },
                jsonBody: { reply: reply }
            };
        } catch (err) {
            context.error('Failed to call Azure OpenAI:', err);
            return { status: 502, jsonBody: { error: 'Could not reach the AI assistant right now.' } };
        }
    }
});
