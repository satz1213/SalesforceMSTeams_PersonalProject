/**
 * LWC entry point for messagingSessionTeamsChatEmbed - mints the same short-lived HMAC bridge
 * token the Case Swarm Chat bridge uses (see TeamsSwarmChatController.mintBridgeToken), scoped to
 * this MessagingSession's Id rather than a Teams chatId, since the Teams chat doesn't exist yet
 * at the moment the LWC needs to start listening for it over SignalR.
 */
public with sharing class MessagingSessionTeamsChatController {
    public class EmbedSession {
        @AuraEnabled
        public Boolean useSignalR;
        @AuraEnabled
        public String reason;
        @AuraEnabled
        public String azureBaseUrl;
        @AuraEnabled
        public String negotiatePath;
        @AuraEnabled
        public String joinPath;
        @AuraEnabled
        public String token;
        @AuraEnabled
        public Long tokenExpiresAt;
        @AuraEnabled
        public String userId;
    }

    @AuraEnabled
    public static EmbedSession getEmbedSession(Id messagingSessionId) {
        EmbedSession session = new EmbedSession();
        session.useSignalR = false;
        session.negotiatePath = '/api/negotiate';
        session.joinPath = '/api/joinChat';
        session.userId = UserInfo.getUserId();

        Teams_Bot_Config__mdt config = Teams_Bot_Config__mdt.getInstance('Default');
        if (config == null || config.Use_Azure_SignalR__c != true) {
            session.reason = 'Azure SignalR is not enabled (Use_Azure_SignalR__c=false).';
            return session;
        }

        String azureBaseUrl = config.Chat_Bridge_Azure_Base_Url__c == null
            ? null
            : config.Chat_Bridge_Azure_Base_Url__c.trim().removeEnd('/');
        String hmacSecret = config.Chat_Bridge_HMAC_Secret__c;
        if (String.isBlank(azureBaseUrl) || String.isBlank(hmacSecret)) {
            session.reason = 'Chat_Bridge_Azure_Base_Url__c or Chat_Bridge_HMAC_Secret__c is blank.';
            return session;
        }

        TeamsSwarmChatController.BridgeToken minted = TeamsSwarmChatController.mintBridgeToken(
            String.valueOf(messagingSessionId),
            UserInfo.getUserId(),
            hmacSecret
        );

        session.useSignalR = true;
        session.azureBaseUrl = azureBaseUrl;
        session.token = minted.token;
        session.tokenExpiresAt = minted.expiresAt;
        return session;
    }

    public class ChatSession {
        @AuraEnabled
        public Boolean chatReady;
        @AuraEnabled
        public Boolean useSignalR;
        @AuraEnabled
        public String reason;
        @AuraEnabled
        public String chatId;
        @AuraEnabled
        public String serviceUrl;
        @AuraEnabled
        public String azureBaseUrl;
        @AuraEnabled
        public String historyPath;
        @AuraEnabled
        public String sendPath;
        @AuraEnabled
        public String negotiatePath;
        @AuraEnabled
        public String joinPath;
        @AuraEnabled
        public String token;
        @AuraEnabled
        public Long tokenExpiresAt;
        @AuraEnabled
        public String senderName;
        @AuraEnabled
        public String senderAadObjectId;
        @AuraEnabled
        public String userId;
    }

    /**
     * Full live-chat session, once the Teams chat exists - separate from getEmbedSession because
     * the SignalR group here is the real Teams chatId (needed for chatHistory/chatSend/live
     * message push, all reused unmodified from the Case Swarm Chat bridge), not this
     * MessagingSession's Id, so it needs its own token minted against that different group key
     * (relay/src/bridgeAuth.js's validateBridgeToken checks the token's embedded group against
     * whatever chatId the caller passes - a token minted for one group won't validate for another).
     */
    @AuraEnabled
    public static ChatSession getChatSession(Id messagingSessionId) {
        ChatSession session = new ChatSession();
        session.chatReady = false;
        session.useSignalR = false;
        session.historyPath = '/api/chatHistory';
        session.sendPath = '/api/chatSend';
        session.negotiatePath = '/api/negotiate';
        session.joinPath = '/api/joinChat';
        session.userId = UserInfo.getUserId();
        session.senderName = UserInfo.getName();
        session.senderAadObjectId = TeamsSwarmChatController.currentUserAadObjectId();

        MessagingSession matchingSession = [
            SELECT Id, Teams_Chat_Id__c, Teams_Bot_Service_Url__c
            FROM MessagingSession
            WHERE Id = :messagingSessionId
            WITH USER_MODE
            LIMIT 1
        ];
        if (String.isBlank(matchingSession.Teams_Chat_Id__c) || String.isBlank(matchingSession.Teams_Bot_Service_Url__c)) {
            session.reason = 'Teams chat is not ready yet.';
            return session;
        }

        Teams_Bot_Config__mdt config = Teams_Bot_Config__mdt.getInstance('Default');
        if (config == null || config.Use_Azure_SignalR__c != true) {
            session.reason = 'Azure SignalR is not enabled (Use_Azure_SignalR__c=false).';
            return session;
        }

        String azureBaseUrl = config.Chat_Bridge_Azure_Base_Url__c == null
            ? null
            : config.Chat_Bridge_Azure_Base_Url__c.trim().removeEnd('/');
        String hmacSecret = config.Chat_Bridge_HMAC_Secret__c;
        if (String.isBlank(azureBaseUrl) || String.isBlank(hmacSecret)) {
            session.reason = 'Chat_Bridge_Azure_Base_Url__c or Chat_Bridge_HMAC_Secret__c is blank.';
            return session;
        }

        TeamsSwarmChatController.BridgeToken minted = TeamsSwarmChatController.mintBridgeToken(
            matchingSession.Teams_Chat_Id__c,
            UserInfo.getUserId(),
            hmacSecret
        );

        session.chatReady = true;
        session.useSignalR = true;
        session.chatId = matchingSession.Teams_Chat_Id__c;
        session.serviceUrl = matchingSession.Teams_Bot_Service_Url__c;
        session.azureBaseUrl = azureBaseUrl;
        session.token = minted.token;
        session.tokenExpiresAt = minted.expiresAt;
        return session;
    }

    public class EndChatResult {
        @AuraEnabled
        public Integer savedCount;
        @AuraEnabled
        public Boolean chatDeleteRequested;
    }

    /**
     * End the Teams chat: archive its history to Swarm_Message__c (via the new
     * Messaging_Session__c lookup, mirroring how Case Swarm Chat's endChat archives to the same
     * object via Case__c), clear this session's Teams_* fields, then (when
     * Teams_Bot_Config__mdt.Default.Delete_Teams_Chat_On_End__c is on) delete the Teams chat.
     * Does not touch MessagingSession.Status - that field is platform-managed by Omni-Channel's
     * own routing/presence engine and isn't writable via plain DML (confirmed live); this only
     * ends the Teams side-channel, not the underlying Messaging conversation.
     *
     * The chat delete is a separate Queueable transaction (MessagingSessionChatDeleteQueueable)
     * for the same callout-after-DML reason TeamsSwarmChatDeleteQueueable is for Case swarms.
     */
    @AuraEnabled
    public static EndChatResult endChat(Id messagingSessionId) {
        MessagingSession matchingSession = [
            SELECT Id, Teams_Chat_Id__c, Teams_Chat_Url__c, Teams_Bot_Service_Url__c
            FROM MessagingSession
            WHERE Id = :messagingSessionId
            WITH USER_MODE
            LIMIT 1
        ];
        if (String.isBlank(matchingSession.Teams_Chat_Id__c)) {
            throw new AuraHandledException('This session has no Teams chat to end.');
        }

        List<TeamsSwarmService.ChatMessageResult> remoteMessages;
        try {
            remoteMessages = TeamsSwarmService.listChatMessages(matchingSession.Teams_Chat_Id__c, 50);
        } catch (TeamsSwarmService.TeamsSwarmException e) {
            throw new AuraHandledException('Could not load Teams history to save transcript: ' + e.getMessage());
        }

        Set<String> remoteIds = new Set<String>();
        for (TeamsSwarmService.ChatMessageResult remote : remoteMessages) {
            if (String.isNotBlank(remote.id)) {
                remoteIds.add(remote.id);
            }
        }

        Map<String, Swarm_Message__c> existingByTeamsId = new Map<String, Swarm_Message__c>();
        if (!remoteIds.isEmpty()) {
            for (Swarm_Message__c existing : [
                SELECT Id, Teams_Message_Id__c
                FROM Swarm_Message__c
                WHERE Messaging_Session__c = :messagingSessionId AND Teams_Message_Id__c IN :remoteIds
            ]) {
                existingByTeamsId.put(existing.Teams_Message_Id__c, existing);
            }
        }

        List<Swarm_Message__c> upserts = new List<Swarm_Message__c>();
        for (TeamsSwarmService.ChatMessageResult remote : remoteMessages) {
            if (String.isBlank(remote.id) || String.isBlank(remote.body)) {
                continue;
            }
            Swarm_Message__c row = existingByTeamsId.containsKey(remote.id)
                ? existingByTeamsId.get(remote.id)
                : new Swarm_Message__c(
                    Messaging_Session__c = messagingSessionId,
                    Teams_Message_Id__c = remote.id
                );
            row.Chat_Id__c = matchingSession.Teams_Chat_Id__c;
            row.Body__c = remote.body;
            row.Sender_Display_Name__c = remote.senderDisplayName;
            row.Sender_Aad_Email__c = remote.senderEmail;
            row.Sent_At__c = remote.createdDateTime;
            // Our chatSend always posts via the bot (onBehalfOf), so every agent message already
            // comes back from Graph as an application/bot post - no extra "was this posted by an
            // agent via a non-bot path" case to preserve here, unlike Case's upsertFromGraph.
            row.Direction__c = remote.isApplication == true ? 'Outbound' : 'Inbound';
            upserts.add(row);
        }

        if (!upserts.isEmpty()) {
            try {
                upsert upserts Teams_Message_Id__c;
            } catch (DmlException e) {
                throw new AuraHandledException('Could not save transcript: ' + e.getMessage());
            }
        }

        Integer saved = [SELECT COUNT() FROM Swarm_Message__c WHERE Messaging_Session__c = :messagingSessionId];
        String chatIdToDelete = matchingSession.Teams_Chat_Id__c;

        try {
            update new MessagingSession(
                Id = messagingSessionId,
                Teams_Chat_Id__c = null,
                Teams_Chat_Url__c = null,
                Teams_Bot_Service_Url__c = null
            );
        } catch (DmlException e) {
            throw new AuraHandledException('Transcript was saved, but the Teams fields could not be cleared: ' + e.getMessage());
        }

        EndChatResult result = new EndChatResult();
        result.savedCount = saved;
        result.chatDeleteRequested = false;

        Teams_Bot_Config__mdt config = Teams_Bot_Config__mdt.getInstance('Default');
        if (config != null && config.Delete_Teams_Chat_On_End__c == true) {
            System.enqueueJob(new MessagingSessionChatDeleteQueueable(messagingSessionId, chatIdToDelete));
            result.chatDeleteRequested = true;
        }

        return result;
    }
}
