/**
 * LWC entry points for the Case Swarm chat bridge (Chat swarms only).
 *
 * Live modes (Teams_Bot_Config__mdt.Default):
 * - Use_Azure_Chat_Bridge__c = false: Apex Graph poll via syncMessages + Bot send via sendMessage.
 * - Use_Azure_Chat_Bridge__c = true, Use_Azure_SignalR__c = false: LWC → Azure chatHistory/chatSend poll.
 * - Both true: LWC → Azure one-shot history + SignalR push (Option D); poll only as disconnect fallback.
 *
 * Salesforce only mints a short-lived HMAC session via getChatBridgeSession (no per-message Apex callouts
 * Swarm_Message__c transcript is written when the agent clicks End Chat, then Case swarm
 * fields are cleared and the Teams chat is soft-deleted when
 * Teams_Bot_Config__mdt.Default.Delete_Teams_Chat_On_End__c is on. Live SignalR chat does
 * not write Swarm_Message__c per message.
 */
public with sharing class TeamsSwarmChatController {
  private static final Integer BRIDGE_TOKEN_TTL_SECONDS = 3600;

  public class ChatState {
    @AuraEnabled
    public Boolean chatEnabled;
    @AuraEnabled
    public String reason;
    @AuraEnabled
    public String swarmStatus;
    @AuraEnabled
    public String swarmType;
    @AuraEnabled
    public String chatId;
    @AuraEnabled
    public String teamUrl;
    @AuraEnabled
    public Boolean botReady;
  }

  public class ChatBridgeSession {
    @AuraEnabled
    public Boolean useAzureBridge;
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

  public class MessageDto {
    @AuraEnabled
    public Id id;
    @AuraEnabled
    public String teamsMessageId;
    @AuraEnabled
    public String body;
    @AuraEnabled
    public String senderDisplayName;
    @AuraEnabled
    public String senderAadEmail;
    @AuraEnabled
    public String direction;
    @AuraEnabled
    public Datetime sentAt;
    @AuraEnabled
    public Id postedByUserId;
  }

  /** LWC End Chat payload — sentAt as ISO string avoids Aura Datetime deserialization failures. */
  public class PersistMessageInput {
    @AuraEnabled
    public String teamsMessageId;
    @AuraEnabled
    public String body;
    @AuraEnabled
    public String senderDisplayName;
    @AuraEnabled
    public String senderAadEmail;
    @AuraEnabled
    public String direction;
    @AuraEnabled
    public String sentAt;
    @AuraEnabled
    public Id postedByUserId;
  }

  public class EndChatResult {
    @AuraEnabled
    public Integer savedCount;
    @AuraEnabled
    public Boolean swarmCleared;
    @AuraEnabled
    public Boolean chatDeleteRequested;
  }

  /**
   * Omni-style utility inbox row: Active Chat swarm the running user can see.
   */
  public class ActiveSwarmItem {
    @AuraEnabled
    public Id caseId;
    @AuraEnabled
    public String caseNumber;
    @AuraEnabled
    public String subject;
    @AuraEnabled
    public String chatId;
    @AuraEnabled
    public String teamUrl;
    @AuraEnabled
    public Boolean botReady;
  }

  /**
   * Cases with an Active Chat swarm (for the Console utility inbox).
   * Respects sharing (USER_MODE). Caps at 40 newest by LastModifiedDate.
   */
  @AuraEnabled
  public static List<ActiveSwarmItem> listActiveChatSwarms() {
    List<ActiveSwarmItem> items = new List<ActiveSwarmItem>();
    for (Case matchingCase : [
      SELECT
        Id,
        CaseNumber,
        Subject,
        Swarm_Team_Id__c,
        Swarm_Team_Url__c,
        Swarm_Bot_Service_Url__c
      FROM Case
      WHERE
        Swarm_Status__c = 'Active'
        AND Swarm_Type__c = 'Chat'
        AND Swarm_Team_Id__c != NULL
      WITH USER_MODE
      ORDER BY LastModifiedDate DESC
      LIMIT 40
    ]) {
      items.add(toActiveSwarmItem(matchingCase));
    }
    return items;
  }

  /**
   * Resolve one Active Chat swarm Case for the utility "Add Case" path.
   */
  @AuraEnabled
  public static ActiveSwarmItem getActiveChatSwarm(Id caseId) {
    if (caseId == null) {
      return null;
    }
    List<Case> rows = [
      SELECT
        Id,
        CaseNumber,
        Subject,
        Swarm_Team_Id__c,
        Swarm_Team_Url__c,
        Swarm_Bot_Service_Url__c,
        Swarm_Status__c,
        Swarm_Type__c
      FROM Case
      WHERE Id = :caseId
      WITH USER_MODE
      LIMIT 1
    ];
    if (rows.isEmpty()) {
      return null;
    }
    Case matchingCase = rows[0];
    if (
      matchingCase.Swarm_Status__c != 'Active' ||
      matchingCase.Swarm_Type__c != 'Chat' ||
      String.isBlank(matchingCase.Swarm_Team_Id__c)
    ) {
      return null;
    }
    return toActiveSwarmItem(matchingCase);
  }

  private static ActiveSwarmItem toActiveSwarmItem(Case matchingCase) {
    ActiveSwarmItem item = new ActiveSwarmItem();
    item.caseId = matchingCase.Id;
    item.caseNumber = matchingCase.CaseNumber;
    item.subject = matchingCase.Subject;
    item.chatId = matchingCase.Swarm_Team_Id__c;
    item.teamUrl = matchingCase.Swarm_Team_Url__c;
    item.botReady = String.isNotBlank(matchingCase.Swarm_Bot_Service_Url__c);
    return item;
  }

  @AuraEnabled(cacheable=true)
  public static ChatState getChatState(Id caseId) {
    ChatState state = new ChatState();
    state.chatEnabled = false;
    if (caseId == null) {
      state.reason = 'No Case selected.';
      return state;
    }

    Case matchingCase = [
      SELECT
        Id,
        Swarm_Status__c,
        Swarm_Type__c,
        Swarm_Team_Id__c,
        Swarm_Team_Url__c,
        Swarm_Bot_Service_Url__c
      FROM Case
      WHERE Id = :caseId
      WITH USER_MODE
      LIMIT 1
    ];

    state.swarmStatus = matchingCase.Swarm_Status__c;
    state.swarmType = matchingCase.Swarm_Type__c;
    state.chatId = matchingCase.Swarm_Team_Id__c;
    state.teamUrl = matchingCase.Swarm_Team_Url__c;
    state.botReady = String.isNotBlank(matchingCase.Swarm_Bot_Service_Url__c);

    if (matchingCase.Swarm_Status__c != 'Active') {
      state.reason = 'Swarm is not active yet.';
    } else if (matchingCase.Swarm_Type__c != 'Chat') {
      state.reason = 'Chat bridge is available for Chat swarms only. Use Open in Teams for Team swarms.';
    } else if (String.isBlank(matchingCase.Swarm_Team_Id__c)) {
      state.reason = 'This case has no Teams chat id.';
    } else if (!state.botReady) {
      state.reason =
        'Waiting for the Teams bot to join this chat (needed to send messages from Salesforce). ' +
        'Open the chat in Teams and wait for the case card, then refresh.';
    } else {
      state.chatEnabled = true;
      state.reason = null;
    }
    return state;
  }

  /**
   * One-time bootstrap for the LWC. When Use_Azure_Chat_Bridge__c is false (or Azure URL/secret
   * are missing), returns useAzureBridge=false so the LWC falls back to Apex Graph polling.
   */
  @AuraEnabled
  public static ChatBridgeSession getChatBridgeSession(Id caseId) {
    ChatBridgeSession session = new ChatBridgeSession();
    session.useAzureBridge = false;
    session.useSignalR = false;
    session.historyPath = '/api/chatHistory';
    session.sendPath = '/api/chatSend';
    session.negotiatePath = '/api/negotiate';
    session.joinPath = '/api/joinChat';
    session.senderName = UserInfo.getName();
    session.userId = UserInfo.getUserId();
    session.senderAadObjectId = currentUserAadObjectId();

    Teams_Bot_Config__mdt config = Teams_Bot_Config__mdt.getInstance('Default');
    Boolean wantAzure =
      config != null &&
      config.Use_Azure_Chat_Bridge__c == true;
    if (!wantAzure) {
      session.reason = 'Azure chat bridge disabled (Use_Azure_Chat_Bridge__c=false). Using Apex Graph polling.';
      return session;
    }

    if (caseId == null) {
      session.reason = 'No Case selected.';
      return session;
    }

    Case matchingCase;
    try {
      matchingCase = requireActiveChatCase(caseId);
    } catch (AuraHandledException e) {
      session.reason = e.getMessage();
      return session;
    }

    if (String.isBlank(matchingCase.Swarm_Bot_Service_Url__c)) {
      session.reason = 'Teams bot is not ready for this chat yet.';
      return session;
    }

    String azureBaseUrl = config.Chat_Bridge_Azure_Base_Url__c == null
      ? null
      : config.Chat_Bridge_Azure_Base_Url__c.trim().removeEnd('/');
    String hmacSecret = config.Chat_Bridge_HMAC_Secret__c;
    if (String.isBlank(azureBaseUrl) || String.isBlank(hmacSecret)) {
      session.reason = 'Azure chat bridge is enabled but Chat_Bridge_Azure_Base_Url__c or Chat_Bridge_HMAC_Secret__c is blank. Falling back to Apex polling.';
      return session;
    }

    BridgeToken minted = mintBridgeToken(matchingCase.Swarm_Team_Id__c, UserInfo.getUserId(), hmacSecret);

    session.useAzureBridge = true;
    session.useSignalR = config.Use_Azure_SignalR__c == true;
    session.chatId = matchingCase.Swarm_Team_Id__c;
    session.serviceUrl = matchingCase.Swarm_Bot_Service_Url__c;
    session.azureBaseUrl = azureBaseUrl;
    session.token = minted.token;
    session.tokenExpiresAt = minted.expiresAt;
    session.reason = null;
    return session;
  }

  public class BridgeToken {
    public String token;
    public Long expiresAt;
  }

  /**
   * Mints a short-lived HMAC bridge-session token in the groupKey|userId|exp format
   * relay/src/bridgeAuth.js validates - shared by getChatBridgeSession (groupKey = Teams chatId)
   * and MessagingSessionTeamsChatController.getEmbedSession (groupKey = MessagingSession Id,
   * since that chat doesn't exist yet when the LWC needs to start listening). One auth mechanism
   * for the whole relay surface rather than two that can drift.
   */
  public static BridgeToken mintBridgeToken(String groupKey, String userId, String hmacSecret) {
    Long exp = Datetime.now().getTime() / 1000 + BRIDGE_TOKEN_TTL_SECONDS;
    String payload = groupKey + '|' + userId + '|' + String.valueOf(exp);
    String token =
      base64UrlEncode(Blob.valueOf(payload)) +
      '.' +
      base64UrlEncode(
        Crypto.generateMac(
          'HmacSHA256',
          Blob.valueOf(payload),
          Blob.valueOf(hmacSecret)
        )
      );
    BridgeToken result = new BridgeToken();
    result.token = token;
    result.expiresAt = exp;
    return result;
  }

  private static String base64UrlEncode(Blob input) {
    String b64 = EncodingUtil.base64Encode(input);
    return b64.replace('+', '-').replace('/', '_').replace('=', '');
  }

  public static String currentUserAadObjectId() {
    List<User> me = [
      SELECT Azure_AD_Object_Id__c
      FROM User
      WHERE Id = :UserInfo.getUserId()
      WITH USER_MODE
      LIMIT 1
    ];
    return me.isEmpty() ? null : me[0].Azure_AD_Object_Id__c;
  }

  @AuraEnabled
  public static List<MessageDto> listStoredMessages(Id caseId) {
    List<Swarm_Message__c> rows = [
      SELECT
        Id,
        Teams_Message_Id__c,
        Body__c,
        Sender_Display_Name__c,
        Sender_Aad_Email__c,
        Direction__c,
        Sent_At__c,
        Posted_By_User__c
      FROM Swarm_Message__c
      WHERE Case__c = :caseId
      WITH USER_MODE
      ORDER BY Sent_At__c ASC NULLS LAST, CreatedDate ASC
      LIMIT 200
    ];
    return toDtos(rows);
  }

  @AuraEnabled
  public static List<MessageDto> syncMessages(Id caseId) {
    // Live Apex-poll path: skip bot/application Graph rows (Outbound already stored on sendMessage).
    return upsertFromGraph(caseId, false);
  }

  /**
   * End Chat (Apex / no Azure bridge): pull Graph history including bot posts and upsert transcript.
   */
  @AuraEnabled
  public static List<MessageDto> endChatSaveTranscript(Id caseId) {
    return upsertFromGraph(caseId, true);
  }

  /**
   * End the SF chat session: upsert Swarm_Message__c transcript, clear Case swarm fields, then
   * (when Teams_Bot_Config__mdt.Default.Delete_Teams_Chat_On_End__c is on) delete the Teams chat.
   * Does NOT delete Swarm_Message__c - the transcript is the whole point of archiving first.
   * Plain DML for Case clear (same pattern as TeamsSwarmController.resetSwarm).
   *
   * Persistence order (callout before DML):
   * 1) Always pull Teams history via Graph while Swarm_Team_Id__c is still set.
   * 2) Merge any LWC/Azure payload (covers in-memory rows Graph skipped, e.g. empty card bodies).
   * Client-only path is used when Graph fails but the LWC still sent rows.
   *
   * The chat delete is a separate Queueable transaction (TeamsSwarmChatDeleteQueueable) because
   * it has to happen after the transcript DML, and Apex can't call out once DML has run.
   */
  @AuraEnabled
  public static EndChatResult endChat(
    Id caseId,
    List<PersistMessageInput> messages
  ) {
    Case matchingCase = requireActiveChatCase(caseId);

    try {
      upsertFromGraph(caseId, true);
    } catch (Exception e) {
      if (messages == null || messages.isEmpty()) {
        throw new AuraHandledException(
          'Could not load Teams history to save transcript: ' + e.getMessage()
        );
      }
      // Graph failed; fall through and persist the client payload before clearing the Case.
    }

    if (messages != null && !messages.isEmpty()) {
      // Re-load Case so Chat_Id__c still comes from Swarm_Team_Id__c before clear.
      matchingCase = requireActiveChatCase(caseId);
      persistTranscriptRows(matchingCase, toMessageDtos(messages));
    }

    Integer saved = [
      SELECT COUNT()
      FROM Swarm_Message__c
      WHERE Case__c = :caseId
    ];

    matchingCase = [
      SELECT
        Id,
        Swarm_Team_Id__c,
        Swarm_Group_Id__c,
        Swarm_Team_Url__c,
        Swarm_Status__c,
        Swarm_Type__c,
        Swarm_Bot_Service_Url__c,
        Swarm_Bot_Install_Error__c
      FROM Case
      WHERE Id = :caseId
      LIMIT 1
    ];

    // Captured before the clear below, since that's the only place the chat id lives.
    String chatIdToDelete = matchingCase.Swarm_Team_Id__c;

    matchingCase.Swarm_Team_Id__c = null;
    matchingCase.Swarm_Group_Id__c = null;
    matchingCase.Swarm_Team_Url__c = null;
    matchingCase.Swarm_Status__c = null;
    matchingCase.Swarm_Type__c = null;
    matchingCase.Swarm_Bot_Service_Url__c = null;
    matchingCase.Swarm_Bot_Install_Error__c = null;
    matchingCase.Swarm_Chat_Delete_Error__c = null;

    try {
      update matchingCase;
    } catch (DmlException e) {
      throw new AuraHandledException(
        'Transcript may have been saved, but swarm fields could not be cleared: ' +
        e.getMessage()
      );
    }

    EndChatResult result = new EndChatResult();
    result.savedCount = saved;
    result.swarmCleared = true;
    result.chatDeleteRequested = false;

    Teams_Bot_Config__mdt config = Teams_Bot_Config__mdt.getInstance('Default');
    if (
      config != null &&
      config.Delete_Teams_Chat_On_End__c == true &&
      String.isNotBlank(chatIdToDelete)
    ) {
      System.enqueueJob(
        new TeamsSwarmChatDeleteQueueable(caseId, chatIdToDelete)
      );
      result.chatDeleteRequested = true;
    }

    return result;
  }

  /**
   * Upsert transcript rows only (no Case clear). Prefer endChat() for the full End Chat action.
   */
  @AuraEnabled
  public static Integer persistTranscript(
    Id caseId,
    List<PersistMessageInput> messages
  ) {
    Case matchingCase = requireActiveChatCase(caseId);
    return persistTranscriptRows(matchingCase, toMessageDtos(messages));
  }

  private static List<MessageDto> toMessageDtos(
    List<PersistMessageInput> inputs
  ) {
    List<MessageDto> dtos = new List<MessageDto>();
    if (inputs == null) {
      return dtos;
    }
    for (PersistMessageInput input : inputs) {
      if (input == null) {
        continue;
      }
      MessageDto dto = new MessageDto();
      dto.teamsMessageId = input.teamsMessageId;
      dto.body = input.body;
      dto.senderDisplayName = input.senderDisplayName;
      dto.senderAadEmail = input.senderAadEmail;
      dto.direction = input.direction;
      dto.postedByUserId = input.postedByUserId;
      dto.sentAt = parseIsoDatetime(input.sentAt);
      dtos.add(dto);
    }
    return dtos;
  }

  private static Datetime parseIsoDatetime(String raw) {
    if (String.isBlank(raw)) {
      return null;
    }
    try {
      return (Datetime) JSON.deserialize(
        '"' + raw.trim() + '"',
        Datetime.class
      );
    } catch (Exception e) {
      return null;
    }
  }

  private static Integer persistTranscriptRows(
    Case matchingCase,
    List<MessageDto> messages
  ) {
    if (messages == null || messages.isEmpty()) {
      return 0;
    }

    Set<String> remoteIds = new Set<String>();
    for (MessageDto dto : messages) {
      if (
        String.isNotBlank(dto.teamsMessageId) && String.isNotBlank(dto.body)
      ) {
        remoteIds.add(dto.teamsMessageId.trim());
      }
    }
    if (remoteIds.isEmpty()) {
      return 0;
    }

    Map<String, Swarm_Message__c> existingByTeamsId = new Map<String, Swarm_Message__c>();
    for (Swarm_Message__c existing : [
      SELECT Id, Teams_Message_Id__c, Direction__c, Posted_By_User__c
      FROM Swarm_Message__c
      WHERE Case__c = :matchingCase.Id AND Teams_Message_Id__c IN :remoteIds
    ]) {
      existingByTeamsId.put(existing.Teams_Message_Id__c, existing);
    }

    List<Swarm_Message__c> upserts = new List<Swarm_Message__c>();
    for (MessageDto dto : messages) {
      if (String.isBlank(dto.teamsMessageId) || String.isBlank(dto.body)) {
        continue;
      }
      String teamsId = dto.teamsMessageId.trim();

      Swarm_Message__c row = existingByTeamsId.containsKey(teamsId)
        ? existingByTeamsId.get(teamsId)
        : new Swarm_Message__c(
            Case__c = matchingCase.Id,
            Teams_Message_Id__c = teamsId
          );

      row.Chat_Id__c = matchingCase.Swarm_Team_Id__c;
      row.Body__c = dto.body;
      row.Sender_Display_Name__c = dto.senderDisplayName;
      row.Sender_Aad_Email__c = dto.senderAadEmail;
      row.Sent_At__c = dto.sentAt;

      Boolean outbound =
        row.Posted_By_User__c != null ||
        row.Direction__c == 'Outbound' ||
        dto.direction == 'Outbound';
      row.Direction__c = outbound ? 'Outbound' : 'Inbound';
      if (
        outbound &&
        row.Posted_By_User__c == null &&
        dto.postedByUserId != null
      ) {
        row.Posted_By_User__c = dto.postedByUserId;
      }

      upserts.add(row);
    }

    if (upserts.isEmpty()) {
      return 0;
    }
    try {
      // Plain DML: agents have create/edit on Swarm_Message__c; USER_MODE upsert was
      // silently brittle with LWC datetime payloads and FLS edge cases.
      upsert upserts Teams_Message_Id__c;
    } catch (DmlException e) {
      throw new AuraHandledException(
        'Could not save transcript: ' + e.getMessage()
      );
    }
    return upserts.size();
  }

  private static List<MessageDto> upsertFromGraph(
    Id caseId,
    Boolean includeApplicationOutbound
  ) {
    Case matchingCase = requireActiveChatCase(caseId);

    List<TeamsSwarmService.ChatMessageResult> remoteMessages;
    try {
      remoteMessages = TeamsSwarmService.listChatMessages(
        matchingCase.Swarm_Team_Id__c,
        50
      );
    } catch (TeamsSwarmService.TeamsSwarmException e) {
      throw new AuraHandledException(
        'Could not sync messages: ' + e.getMessage()
      );
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
        SELECT Id, Teams_Message_Id__c, Direction__c, Posted_By_User__c, Body__c
        FROM Swarm_Message__c
        WHERE Case__c = :caseId AND Teams_Message_Id__c IN :remoteIds
      ]) {
        existingByTeamsId.put(existing.Teams_Message_Id__c, existing);
      }
    }

    List<Swarm_Message__c> upserts = new List<Swarm_Message__c>();
    for (TeamsSwarmService.ChatMessageResult remote : remoteMessages) {
      if (String.isBlank(remote.id) || String.isBlank(remote.body)) {
        continue;
      }

      // Live Apex poll skips bot posts (Outbound already stored on sendMessage).
      // End Chat includes them as Outbound transcript rows.
      if (remote.isApplication == true && !includeApplicationOutbound) {
        continue;
      }

      Swarm_Message__c row = existingByTeamsId.containsKey(remote.id)
        ? existingByTeamsId.get(remote.id)
        : new Swarm_Message__c(
            Case__c = caseId,
            Teams_Message_Id__c = remote.id
          );

      row.Chat_Id__c = matchingCase.Swarm_Team_Id__c;
      row.Body__c = remote.body;
      row.Sender_Display_Name__c = remote.senderDisplayName;
      row.Sender_Aad_Email__c = remote.senderEmail;
      row.Sent_At__c = remote.createdDateTime;

      Boolean keepOutbound =
        row.Posted_By_User__c != null ||
        row.Direction__c == 'Outbound' ||
        remote.isApplication == true;
      if (keepOutbound) {
        row.Direction__c = 'Outbound';
      } else {
        row.Direction__c = 'Inbound';
      }

      upserts.add(row);
    }

    if (!upserts.isEmpty()) {
      try {
        upsert upserts Teams_Message_Id__c;
      } catch (DmlException e) {
        throw new AuraHandledException(
          'Could not save synced messages: ' + e.getMessage()
        );
      }
    }

    return listStoredMessages(caseId);
  }

  @AuraEnabled
  public static List<MessageDto> sendMessage(Id caseId, String body) {
    if (String.isBlank(body)) {
      throw new AuraHandledException('Message cannot be empty.');
    }

    Case matchingCase = requireActiveChatCase(caseId);
    if (String.isBlank(matchingCase.Swarm_Bot_Service_Url__c)) {
      throw new AuraHandledException(
        'Teams bot is not ready for this chat yet (Swarm Bot Service Url is blank). ' +
          'Wait for the case card to appear in Teams, then try again. ' +
          'Graph application auth cannot send live chat messages (401).'
      );
    }

    String trimmed = body.trim();
    String senderName = UserInfo.getName();
    String senderAadObjectId = currentUserAadObjectId();

    String activityId;
    try {
      activityId = TeamsBotConversationService.sendAgentText(
        matchingCase.Swarm_Bot_Service_Url__c,
        matchingCase.Swarm_Team_Id__c,
        trimmed,
        senderName,
        senderAadObjectId
      );
    } catch (TeamsBotConversationService.TeamsBotConversationException e) {
      throw new AuraHandledException(
        'Could not send message: ' + e.getMessage()
      );
    }

    Swarm_Message__c row = new Swarm_Message__c(
      Case__c = caseId,
      Teams_Message_Id__c = 'bot:' + activityId,
      Chat_Id__c = matchingCase.Swarm_Team_Id__c,
      Body__c = trimmed,
      Sender_Display_Name__c = senderName,
      Direction__c = 'Outbound',
      Sent_At__c = Datetime.now(),
      Posted_By_User__c = UserInfo.getUserId()
    );

    try {
      insert as user row;
    } catch (DmlException e) {
      throw new AuraHandledException(
        'Message was posted to Teams, but could not be saved in Salesforce: ' +
        e.getMessage()
      );
    }

    return listStoredMessages(caseId);
  }

  private static Case requireActiveChatCase(Id caseId) {
    Case matchingCase = [
      SELECT
        Id,
        Swarm_Status__c,
        Swarm_Type__c,
        Swarm_Team_Id__c,
        Swarm_Team_Url__c,
        Swarm_Bot_Service_Url__c
      FROM Case
      WHERE Id = :caseId
      WITH USER_MODE
      LIMIT 1
    ];

    if (
      matchingCase.Swarm_Status__c != 'Active' ||
      matchingCase.Swarm_Type__c != 'Chat' ||
      String.isBlank(matchingCase.Swarm_Team_Id__c)
    ) {
      throw new AuraHandledException(
        'Chat is only available for an Active Chat swarm.'
      );
    }
    return matchingCase;
  }

  private static List<MessageDto> toDtos(List<Swarm_Message__c> rows) {
    List<MessageDto> dtos = new List<MessageDto>();
    for (Swarm_Message__c row : rows) {
      MessageDto dto = new MessageDto();
      dto.id = row.Id;
      dto.teamsMessageId = row.Teams_Message_Id__c;
      dto.body = row.Body__c;
      dto.senderDisplayName = row.Sender_Display_Name__c;
      dto.senderAadEmail = row.Sender_Aad_Email__c;
      dto.direction = row.Direction__c;
      dto.sentAt = row.Sent_At__c;
      dto.postedByUserId = row.Posted_By_User__c;
      dtos.add(dto);
    }
    return dtos;
  }
}
