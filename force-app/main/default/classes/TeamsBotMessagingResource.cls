/**
 * Messaging endpoint for the Case Swarm Teams bot. NOT called directly by Bot
 * Framework - see the relay in relay/teamsBotRelay/ and README.md section 6f.
 *
 * The relay authenticates to Salesforce as a real internal user (OAuth 2.0
 * Client Credentials against a Connected App, "Run As" a chosen user - see
 * README.md 6g) and calls this class at the org's normal
 * /services/apexrest/teamsbot/messages endpoint, not through a Site/Guest
 * User. That's deliberate: Salesforce enforces "Secure guest user record
 * access" for Guest Users - confirmed the hard way, it blocks Case reads for
 * the guest context even from an async Queueable job the guest enqueues, and
 * neither View All Case nor a sharing rule can be granted around it (Guest
 * User license restrictions and a "trivial share" rejection, respectively).
 * Running as a real user sidesteps all of that, at the cost of that user's
 * Case access being as broad as their profile allows - see README.md 6g's
 * security note on choosing that user.
 *
 * Since the relay's call now carries a genuine Salesforce session in the
 * standard Authorization header, Bot Framework's JWT travels in a separate
 * custom header (X-Bot-Framework-Authorization) instead. That JWT, validated
 * by TeamsBotJwtValidator, is what actually proves a request came from Bot
 * Framework - the Salesforce session only proves the relay is a legitimate
 * integration, not who's really on the other end of any given request.
 *
 * Two activity types matter:
 * - conversationUpdate / installationUpdate (the bot was just added to a
 *   swarm chat, via TeamsSwarmService.installBotApp): capture the serviceUrl
 *   and post the initial view card.
 * - invoke, name "adaptiveCard/action" (someone clicked Edit/Save/Cancel on
 *   the card): apply the edit if any, and return a refreshed card as the
 *   InvokeResponse body so Teams swaps it in place. This is the Adaptive
 *   Card Universal Action model - see TeamsAdaptiveCardBuilder's header
 *   comment for why this requires a bot rather than a plain Graph message.
 *
 * Everything else (plain messages, reactions, other invokes) is acknowledged
 * with an empty 200 and ignored, since Bot Framework retries on non-2xx.
 */
@RestResource(urlMapping='/teamsbot/messages')
global with sharing class TeamsBotMessagingResource {
    @HttpPost
    global static void doPost() {
        RestRequest req = RestContext.request;
        RestResponse res = RestContext.response;

        Teams_Bot_Config__mdt config = Teams_Bot_Config__mdt.getInstance('Default');
        Map<String, Object> activity;
        try {
            TeamsBotJwtValidator.validate(req.headers.get('X-Bot-Framework-Authorization'), config?.Microsoft_App_Id__c);
            activity = (Map<String, Object>) JSON.deserializeUntyped(req.requestBody?.toString());
        } catch (TeamsBotJwtValidator.TeamsBotAuthException e) {
            res.statusCode = 401;
            return;
        } catch (Exception e) {
            res.statusCode = 400;
            return;
        }

        String activityType = (String) activity.get('type');
        res.statusCode = 200;

        // Teams sends "installationUpdate" (action=add) when the bot is installed into a chat
        // via Graph's POST /chats/{id}/installedApps - the "conversationUpdate" + membersAdded
        // pattern (kept here too) is what a normal Teams-UI-driven "Add" produces instead.
        // Both carry the same conversation.id/serviceUrl handleBotInstalled needs.
        Boolean isInstallationAdd = activityType == 'installationUpdate' && 'add'.equals((String) activity.get('action'));
        if (isInstallationAdd || (activityType == 'conversationUpdate' && botWasJustAdded(activity))) {
            handleBotInstalled(activity);
        } else if (activityType == 'invoke' && 'adaptiveCard/action'.equals((String) activity.get('name'))) {
            res.responseBody = Blob.valueOf(JSON.serialize(handleCardAction(activity)));
        }
    }

    private static Boolean botWasJustAdded(Map<String, Object> activity) {
        Map<String, Object> recipient = (Map<String, Object>) activity.get('recipient');
        String botId = recipient == null ? null : (String) recipient.get('id');
        List<Object> membersAdded = (List<Object>) activity.get('membersAdded');
        if (botId == null || membersAdded == null) {
            return false;
        }
        for (Object memberObj : membersAdded) {
            if (botId.equals((String) ((Map<String, Object>) memberObj).get('id'))) {
                return true;
            }
        }
        return false;
    }

    /**
     * Teams sends both an installationUpdate and a separate conversationUpdate for the same
     * "bot was added" moment (confirmed from real logs, ~1 second apart) - doPost() treats
     * either as a trigger, so without a guard this runs twice per swarm and posts the card
     * twice. Swarm_Bot_Service_Url__c doubles as that guard (only ever set here).
     *
     * FOR UPDATE alone isn't enough to make that guard race-safe: it doesn't reliably hold
     * across a callout (confirmed the hard way - two deliveries ~1 second apart both read the
     * row as unclaimed and both sent a card, because Salesforce can't hold a DB lock open while
     * waiting on an external HTTP call). So the claim has to be a fast DML that commits *before*
     * the slow sendCard callout, not after - and callouts are blocked after any DML in the same
     * transaction, so claiming and sending can't happen in one transaction either. Hence the
     * split: claim synchronously here (fast, no callout in the way), hand the actual send off to
     * TeamsBotInstalledCardQueueable as a separate transaction.
     */
    private static void handleBotInstalled(Map<String, Object> activity) {
        Map<String, Object> conversation = (Map<String, Object>) activity.get('conversation');
        String conversationId = conversation == null ? null : (String) conversation.get('id');
        String serviceUrl = (String) activity.get('serviceUrl');
        if (String.isBlank(conversationId) || String.isBlank(serviceUrl)) {
            return;
        }

        List<Case> matches = [
            SELECT Id, Swarm_Bot_Service_Url__c
            FROM Case
            WHERE Swarm_Team_Id__c = :conversationId AND Swarm_Type__c = 'Chat'
            LIMIT 1
            FOR UPDATE
        ];
        if (!matches.isEmpty()) {
            if (matches[0].Swarm_Bot_Service_Url__c != null) {
                return;
            }
            update new Case(Id = matches[0].Id, Swarm_Bot_Service_Url__c = serviceUrl);
            System.enqueueJob(new TeamsBotInstalledCardQueueable(matches[0].Id, conversationId, serviceUrl));
            return;
        }

        signalMessagingSessionChatReady(conversationId, serviceUrl);
    }

    /**
     * Case-less plain Teams chats (see MessagingSessionTeamsChatQueueable) have no card flow of
     * their own, but DO support a live chat window (see messagingSessionTeamsChatEmbed) that
     * needs Teams_Bot_Service_Url__c to post messages via TeamsBotConversationService - same role
     * Swarm_Bot_Service_Url__c plays for Case swarms. This also tells the relay which SignalR
     * group to push "chat ready" to, via the response body, since the relay only knows the raw
     * conversationId, not which MessagingSession it belongs to (see
     * relay/src/functions/teamsBotRelay.js). No claim-lock needed here the way the Case branch
     * above has one: Teams' documented double-delivery (installationUpdate + conversationUpdate
     * ~1s apart) just means writing the same serviceUrl value twice and a harmless redundant
     * SignalR push, not a duplicate card post.
     */
    private static void signalMessagingSessionChatReady(String conversationId, String serviceUrl) {
        List<MessagingSession> sessionMatches = [
            SELECT Id, Teams_Chat_Id__c, Teams_Chat_Url__c, Teams_Bot_Service_Url__c
            FROM MessagingSession
            WHERE Teams_Chat_Id__c = :conversationId
            LIMIT 1
        ];
        if (sessionMatches.isEmpty()) {
            return;
        }

        if (String.isBlank(sessionMatches[0].Teams_Bot_Service_Url__c)) {
            update new MessagingSession(Id = sessionMatches[0].Id, Teams_Bot_Service_Url__c = serviceUrl);
        }

        RestContext.response.responseBody = Blob.valueOf(JSON.serialize(new Map<String, Object>{
            'signalRGroup' => sessionMatches[0].Id,
            'teamsChatId' => sessionMatches[0].Teams_Chat_Id__c,
            'teamsChatUrl' => sessionMatches[0].Teams_Chat_Url__c,
            'serviceUrl' => serviceUrl
        }));
    }

    private static Map<String, Object> handleCardAction(Map<String, Object> activity) {
        Map<String, Object> conversation = (Map<String, Object>) activity.get('conversation');
        String conversationId = conversation == null ? null : (String) conversation.get('id');
        Map<String, Object> invokeValue = (Map<String, Object>) activity.get('value');
        Map<String, Object> action = invokeValue == null ? null : (Map<String, Object>) invokeValue.get('action');
        Map<String, Object> data = action == null ? null : (Map<String, Object>) action.get('data');
        String verb = action == null ? null : (String) action.get('verb');

        if (data == null || !(data.get('caseId') instanceof String)) {
            return errorResponse('Missing case reference.');
        }

        // Scope the edit to the case actually tied to this conversation, rather than trusting
        // caseId alone - the JWT proves the request is genuinely from Bot Framework, not that
        // the submitted data wasn't tampered with client-side.
        String caseIdParam = (String) data.get('caseId');
        List<Case> matches = [
            SELECT Id, CaseNumber, Subject, Description, Status, Priority, OwnerId, Owner.Name
            FROM Case
            WHERE Id = :caseIdParam AND Swarm_Team_Id__c = :conversationId
            LIMIT 1
        ];
        if (matches.isEmpty()) {
            return errorResponse('This case is no longer linked to this chat.');
        }
        Case matchingCase = matches[0];

        if ('save'.equals(verb)) {
            applyEdits(matchingCase, data);
            update matchingCase;
            // Re-query rather than trust the in-memory Owner.Name relationship, which still
            // reflects whoever owned the case before this update if ownerId just changed.
            matchingCase = [SELECT Id, CaseNumber, Subject, Description, Status, Priority, OwnerId, Owner.Name FROM Case WHERE Id = :matchingCase.Id];
        }

        Map<String, Object> card = 'edit'.equals(verb) ? buildEditCard(matchingCase) : TeamsAdaptiveCardBuilder.buildViewCard(toCardData(matchingCase));
        return new Map<String, Object>{ 'statusCode' => 200, 'type' => 'application/vnd.microsoft.card.adaptive', 'value' => card };
    }

    private static void applyEdits(Case matchingCase, Map<String, Object> data) {
        if (data.get('status') instanceof String) {
            matchingCase.Status = (String) data.get('status');
        }
        if (data.get('priority') instanceof String) {
            matchingCase.Priority = (String) data.get('priority');
        }
        if (data.get('subject') instanceof String) {
            matchingCase.Subject = (String) data.get('subject');
        }
        if (data.get('description') instanceof String) {
            matchingCase.Description = (String) data.get('description');
        }
        if (data.get('ownerId') instanceof String && String.isNotBlank((String) data.get('ownerId'))) {
            matchingCase.OwnerId = (Id) (String) data.get('ownerId');
        }
    }

    private static Map<String, Object> buildEditCard(Case matchingCase) {
        return TeamsAdaptiveCardBuilder.buildEditCard(toCardData(matchingCase), picklistValues(Case.Status), picklistValues(Case.Priority), ownerOptions());
    }

    /** public: also used by TeamsBotInstalledCardQueueable. */
    public static TeamsAdaptiveCardBuilder.CaseCardData toCardData(Case matchingCase) {
        TeamsAdaptiveCardBuilder.CaseCardData data = new TeamsAdaptiveCardBuilder.CaseCardData();
        data.caseId = matchingCase.Id;
        data.caseNumber = matchingCase.CaseNumber;
        data.subject = matchingCase.Subject;
        data.description = matchingCase.Description;
        data.status = matchingCase.Status;
        data.priority = matchingCase.Priority;
        data.ownerId = matchingCase.OwnerId;
        data.ownerName = matchingCase.Owner?.Name;
        return data;
    }

    private static List<String> picklistValues(Schema.SObjectField field) {
        List<String> values = new List<String>();
        for (Schema.PicklistEntry entry : field.getDescribe().getPicklistValues()) {
            if (entry.isActive()) {
                values.add(entry.getValue());
            }
        }
        return values;
    }

    /** Same eligibility as TeamsSwarmController.searchUsers: only users who could plausibly be a swarm member. */
    private static List<TeamsAdaptiveCardBuilder.OwnerOption> ownerOptions() {
        List<TeamsAdaptiveCardBuilder.OwnerOption> options = new List<TeamsAdaptiveCardBuilder.OwnerOption>();
        for (User u : [SELECT Id, Name FROM User WHERE IsActive = true AND Azure_AD_Email_Id__c != null ORDER BY Name LIMIT 50]) {
            TeamsAdaptiveCardBuilder.OwnerOption option = new TeamsAdaptiveCardBuilder.OwnerOption();
            option.userId = u.Id;
            option.name = u.Name;
            options.add(option);
        }
        return options;
    }

    private static Map<String, Object> errorResponse(String message) {
        return new Map<String, Object>{
            'statusCode' => 200,
            'type' => 'application/vnd.microsoft.activity.message',
            'value' => message
        };
    }
}
