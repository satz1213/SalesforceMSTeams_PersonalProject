/**
 * Posts Adaptive Card messages into a Teams conversation via the Bot Framework
 * Connector API (v3/conversations), authenticated through the MS_Bot_Framework
 * Named Credential - see README.md for the App registration/Named Credential
 * setup this depends on.
 *
 * This is a different API/auth flow from TeamsSwarmService's Graph calls:
 * Graph creates and manages the chat itself, but only a message sent by a
 * registered bot through the Connector API can carry an Action.Execute button
 * that round-trips back to TeamsBotMessagingResource for inline editing.
 */
public with sharing class TeamsBotConversationService {
    public class TeamsBotConversationException extends Exception {
    }

    private static final String NAMED_CREDENTIAL = 'MS_Bot_Framework';
    private static final String EXPECTED_HOST = 'https://smba.trafficmanager.net';

    /** Posts a new Adaptive Card message into the conversation. Returns the new activity's id. */
    public static String sendCard(String serviceUrl, String conversationId, Map<String, Object> adaptiveCard) {
        Map<String, Object> body = new Map<String, Object>{
            'type' => 'message',
            'attachments' => new List<Object>{ new Map<String, Object>{ 'contentType' => 'application/vnd.microsoft.card.adaptive', 'content' => adaptiveCard } }
        };
        return postActivity(serviceUrl, conversationId, body, 'Failed to post card');
    }

    /**
     * Posts a plain-text message as the Teams bot. Used by the Case Swarm Chat bridge because
     * Graph POST /chats/{id}/messages rejects application-only tokens (401 - migration only).
     */
    public static String sendText(String serviceUrl, String conversationId, String text) {
        return sendAgentText(serviceUrl, conversationId, text, null, null);
    }

    /**
     * Posts an agent chat message as a normal Teams markdown text message (not a card).
     * onBehalfOf is best-effort when senderAadObjectId is present.
     */
    public static String sendAgentText(
        String serviceUrl,
        String conversationId,
        String text,
        String senderDisplayName,
        String senderAadObjectId
    ) {
        if (String.isBlank(text)) {
            throw new TeamsBotConversationException('Message text is required.');
        }
        String message = text.trim();
        String senderName = String.isBlank(senderDisplayName) ? 'Agent' : senderDisplayName.trim();
        String safeName = senderName.replace('\\', '\\\\').replace('*', '\\*').replace('_', '\\_').replace('`', '\\`');

        Map<String, Object> body = new Map<String, Object>{
            'type' => 'message',
            'textFormat' => 'markdown',
            'text' => '**' + safeName + ':** ' + message
        };

        if (String.isNotBlank(senderAadObjectId)) {
            String aad = senderAadObjectId.trim().removeStart('{').removeEnd('}');
            body.put(
                'channelData',
                new Map<String, Object>{
                    'onBehalfOf' => new List<Object>{
                        new Map<String, Object>{
                            'itemId' => 0,
                            'mentionType' => 'person',
                            'mri' => '8:orgid:' + aad,
                            'displayName' => senderName
                        }
                    }
                }
            );
        }
        return postActivity(serviceUrl, conversationId, body, 'Failed to post text message');
    }

    private static String postActivity(String serviceUrl, String conversationId, Map<String, Object> body, String errorPrefix) {
        HttpRequest req = buildRequest(serviceUrl, '/v3/conversations/' + EncodingUtil.urlEncode(conversationId, 'UTF-8') + '/activities', 'POST');
        req.setBody(JSON.serialize(body));
        HttpResponse res = new Http().send(req);

        if (res.getStatusCode() != 200 && res.getStatusCode() != 201) {
            throw new TeamsBotConversationException(errorPrefix + ': ' + res.getStatusCode() + ' ' + res.getBody());
        }

        Map<String, Object> parsed = (Map<String, Object>) JSON.deserializeUntyped(res.getBody());
        return (String) parsed.get('id');
    }

    private static HttpRequest buildRequest(String serviceUrl, String path, String method) {
        HttpRequest req = new HttpRequest();
        req.setEndpoint('callout:' + NAMED_CREDENTIAL + relativePathFor(serviceUrl) + path);
        req.setMethod(method);
        req.setHeader('Content-Type', 'application/json');
        req.setTimeout(30000);
        return req;
    }

    /**
     * Bot Framework's serviceUrl is per-conversation and region-specific (e.g.
     * https://smba.trafficmanager.net/amer/), but every Teams region observed to
     * date shares the same host - so one Named Credential (base URL
     * https://smba.trafficmanager.net) works as long as we forward the region
     * path segment. If a serviceUrl ever shows up on a different host (e.g. a
     * national cloud), this throws loudly instead of silently calling the wrong
     * endpoint.
     */
    private static String relativePathFor(String serviceUrl) {
        if (String.isBlank(serviceUrl) || !serviceUrl.startsWith(EXPECTED_HOST)) {
            throw new TeamsBotConversationException(
                'Unexpected Bot Framework serviceUrl host: ' + serviceUrl + '. Update MS_Bot_Framework Named Credential / relativePathFor() to match.'
            );
        }
        String relative = serviceUrl.substring(EXPECTED_HOST.length());
        return relative.endsWith('/') ? relative.substring(0, relative.length() - 1) : relative;
    }
}
