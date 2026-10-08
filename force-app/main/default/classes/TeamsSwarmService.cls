/**
 * Server-side Graph API calls for creating and provisioning a case swarm Team.
 * All callouts go through the MS_Graph Named Credential - see README.md.
 *
 * Group creation and team-enablement are split into separate calls because Graph
 * needs a few seconds to propagate a newly created M365 group before
 * PUT /groups/{id}/team will recognize it (a 404 during that window is expected,
 * not an error) - see TeamsSwarmProvisionQueueable for the retry loop.
 *
 * Member/owner identifiers throughout this class (ownerIdentifier, memberIdentifiers)
 * are User.Azure_AD_Email_Id__c values (a userPrincipalName, typically the person's
 * Microsoft email) - Graph's /users/{id|upn} and chat member bindings both accept a
 * UPN in place of the object id, which is what lets the caller (TeamsSwarmController)
 * avoid needing anyone's actual Azure AD object id populated.
 */
public with sharing class TeamsSwarmService {
  public static final String NAMED_CREDENTIAL = 'MS_Graph';

  public class TeamsSwarmException extends Exception {
  }

  public static String webUrlFor(String groupId) {
    return 'https://teams.microsoft.com/l/team/' +
      groupId +
      '/conversations?groupId=' +
      groupId;
  }

  public static String createGroup(
    String caseNumber,
    String caseSubject,
    String ownerIdentifier
  ) {
    // Suffixed with a timestamp so a retry after a failed/orphaned prior attempt
    // doesn't collide on mailNickname, which Graph requires to be tenant-unique.
    String mailNickname =
      'case-swarm-' +
      caseNumber.replaceAll('[^a-zA-Z0-9]', '') +
      '-' +
      String.valueOf(Datetime.now().getTime());
    Map<String, Object> body = new Map<String, Object>{
      'displayName' => 'Case Swarm - ' +
      caseNumber +
      ' - ' +
      caseSubject,
      'mailEnabled' => true,
      'mailNickname' => mailNickname,
      'securityEnabled' => false,
      'groupTypes' => new List<String>{ 'Unified' },
      'owners@odata.bind' => new List<String>{
        'https://graph.microsoft.com/v1.0/users/' + ownerIdentifier
      }
    };

    HttpRequest req = buildRequest('/v1.0/groups', 'POST');
    req.setBody(JSON.serialize(body));
    HttpResponse res = new Http().send(req);

    if (res.getStatusCode() != 201) {
      throw new TeamsSwarmException(
        'Failed to create M365 group: ' +
          res.getStatusCode() +
          ' ' +
          res.getBody()
      );
    }

    Map<String, Object> parsed = (Map<String, Object>) JSON.deserializeUntyped(
      res.getBody()
    );
    return (String) parsed.get('id');
  }

  /**
   * Returns true once the group is team-enabled (including "already enabled"),
   * false if Graph hasn't finished propagating the group yet and this should be retried later.
   */
  public static Boolean enableTeam(String groupId) {
    HttpRequest req = buildRequest('/v1.0/groups/' + groupId + '/team', 'PUT');
    req.setBody('{}');
    HttpResponse res = new Http().send(req);

    if (
      res.getStatusCode() == 201 ||
      res.getStatusCode() == 202 ||
      res.getStatusCode() == 409
    ) {
      return true;
    }
    if (res.getStatusCode() == 404) {
      return false;
    }
    throw new TeamsSwarmException(
      'Failed to team-enable group ' +
        groupId +
        ': ' +
        res.getStatusCode() +
        ' ' +
        res.getBody()
    );
  }

  /**
   * memberIdentifiers can be either Azure AD object ids or userPrincipalNames (typically an
   * email) - bound via /users/{id|upn}, not /directoryObjects/{id}, specifically so a UPN
   * works here too. (/directoryObjects/{id} only accepts the literal object id.)
   */
  public static void addMembers(
    String groupId,
    List<String> memberIdentifiers
  ) {
    if (memberIdentifiers == null || memberIdentifiers.isEmpty()) {
      return;
    }

    List<Object> requests = new List<Object>();
    Integer requestNumber = 0;
    for (String memberIdentifier : memberIdentifiers) {
      requestNumber++;
      requests.add(
        new Map<String, Object>{
          'id' => String.valueOf(requestNumber),
          'method' => 'POST',
          'url' => '/groups/' +
          groupId +
          '/members/$ref',
          'headers' => new Map<String, Object>{
            'Content-Type' => 'application/json'
          },
          'body' => new Map<String, Object>{
            '@odata.id' => 'https://graph.microsoft.com/v1.0/users/' +
            memberIdentifier
          }
        }
      );
    }

    HttpRequest req = buildRequest('/v1.0/$batch', 'POST');
    req.setBody(
      JSON.serialize(new Map<String, Object>{ 'requests' => requests })
    );
    HttpResponse res = new Http().send(req);

    if (res.getStatusCode() != 200) {
      throw new TeamsSwarmException(
        'Batch member-add call failed: ' +
          res.getStatusCode() +
          ' ' +
          res.getBody()
      );
    }

    Map<String, Object> parsed = (Map<String, Object>) JSON.deserializeUntyped(
      res.getBody()
    );
    List<Object> responses = (List<Object>) parsed.get('responses');
    List<String> failures = new List<String>();
    for (Object responseObj : responses) {
      Map<String, Object> singleResponse = (Map<String, Object>) responseObj;
      Integer status = (Integer) singleResponse.get('status');
      if (status == null || status >= 300) {
        failures.add(describeBatchFailure(singleResponse, status));
      }
    }

    if (!failures.isEmpty()) {
      throw new TeamsSwarmException(
        'Some members failed to add: ' + String.join(failures, '; ')
      );
    }
  }

  public class MemberInfo {
    @AuraEnabled
    public String removalId;
    @AuraEnabled
    public String displayName;
    @AuraEnabled
    public String email;
    @AuraEnabled
    public Boolean isOwner;
  }

  /**
   * Current members of the swarm Team's underlying M365 group. removalId is the member's
   * directory object id - DELETE /groups/{id}/members/{id}/$ref needs that object id, not the
   * UPN this integration otherwise keys off of.
   */
  public static List<MemberInfo> listGroupMembers(String groupId) {
    HttpRequest req = buildRequest(
      '/v1.0/groups/' +
        groupId +
        '/members?$select=id,displayName,mail,userPrincipalName',
      'GET'
    );
    HttpResponse res = new Http().send(req);

    if (res.getStatusCode() != 200) {
      throw new TeamsSwarmException(
        'Failed to list group members: ' +
          res.getStatusCode() +
          ' ' +
          res.getBody()
      );
    }

    Map<String, Object> parsed = (Map<String, Object>) JSON.deserializeUntyped(
      res.getBody()
    );
    List<Object> values = (List<Object>) parsed.get('value');
    List<MemberInfo> members = new List<MemberInfo>();
    if (values == null) {
      return members;
    }
    for (Object valueObj : values) {
      Map<String, Object> value = (Map<String, Object>) valueObj;
      MemberInfo info = new MemberInfo();
      info.removalId = (String) value.get('id');
      info.displayName = (String) value.get('displayName');
      info.email = value.get('mail') != null
        ? (String) value.get('mail')
        : (String) value.get('userPrincipalName');
      info.isOwner = false;
      members.add(info);
    }
    return members;
  }

  /**
   * Needs Group.ReadWrite.All (already granted for group creation - see README.md section 1).
   * 404 means the member is already gone - same end state, not an error.
   */
  public static void removeGroupMember(String groupId, String memberObjectId) {
    if (String.isBlank(memberObjectId)) {
      throw new TeamsSwarmException(
        'Cannot remove a group member without an object id.'
      );
    }

    HttpRequest req = buildRequest(
      '/v1.0/groups/' + groupId + '/members/' + memberObjectId + '/$ref',
      'DELETE'
    );
    HttpResponse res = new Http().send(req);

    if (res.getStatusCode() != 204 && res.getStatusCode() != 404) {
      throw new TeamsSwarmException(
        'Failed to remove group member ' +
          memberObjectId +
          ': ' +
          res.getStatusCode() +
          ' ' +
          res.getBody()
      );
    }
  }

  public class ChatResult {
    @AuraEnabled
    public String chatId;
    @AuraEnabled
    public String webUrl;
  }

  /**
   * Creates a Teams group chat directly - no owner-propagation delay and no team-enable
   * step, unlike a Group/Team. allMemberIdentifiers must include ownerIdentifier.
   */
  public static ChatResult createChat(
    String caseNumber,
    String caseSubject,
    String ownerIdentifier,
    List<String> allMemberIdentifiers
  ) {
    return createChat(
      'Case Swarm - ' + caseNumber + ' - ' + caseSubject,
      ownerIdentifier,
      allMemberIdentifiers
    );
  }

  /**
   * Same as the 4-arg overload above but with a caller-supplied topic, for callers that aren't
   * building a Case Swarm chat (e.g. MessagingSessionTeamsChatQueueable) and shouldn't have their
   * chat topic branded "Case Swarm - ...".
   */
  public static ChatResult createChat(
    String topic,
    String ownerIdentifier,
    List<String> allMemberIdentifiers
  ) {
    List<Object> members = new List<Object>();
    for (String memberIdentifier : allMemberIdentifiers) {
      members.add(
        chatMemberPayload(memberIdentifier, memberIdentifier == ownerIdentifier)
      );
    }

    Map<String, Object> body = new Map<String, Object>{
      'chatType' => 'group',
      'topic' => topic,
      'members' => members
    };

    HttpRequest req = buildRequest('/v1.0/chats', 'POST');
    req.setBody(JSON.serialize(body));
    HttpResponse res = new Http().send(req);

    if (res.getStatusCode() != 201) {
      throw new TeamsSwarmException(
        'Failed to create chat: ' + res.getStatusCode() + ' ' + res.getBody()
      );
    }

    Map<String, Object> parsed = (Map<String, Object>) JSON.deserializeUntyped(
      res.getBody()
    );
    ChatResult result = new ChatResult();
    result.chatId = (String) parsed.get('id');
    result.webUrl = (String) parsed.get('webUrl');
    return result;
  }

  public static void addChatMembers(
    String chatId,
    List<String> memberIdentifiers
  ) {
    if (memberIdentifiers == null || memberIdentifiers.isEmpty()) {
      return;
    }

    List<Object> requests = new List<Object>();
    Integer requestNumber = 0;
    for (String memberIdentifier : memberIdentifiers) {
      requestNumber++;
      requests.add(
        new Map<String, Object>{
          'id' => String.valueOf(requestNumber),
          'method' => 'POST',
          'url' => '/chats/' +
          chatId +
          '/members',
          'headers' => new Map<String, Object>{
            'Content-Type' => 'application/json'
          },
          'body' => chatMemberPayload(memberIdentifier, false)
        }
      );
    }

    HttpRequest req = buildRequest('/v1.0/$batch', 'POST');
    req.setBody(
      JSON.serialize(new Map<String, Object>{ 'requests' => requests })
    );
    HttpResponse res = new Http().send(req);

    if (res.getStatusCode() != 200) {
      throw new TeamsSwarmException(
        'Batch chat member-add call failed: ' +
          res.getStatusCode() +
          ' ' +
          res.getBody()
      );
    }

    Map<String, Object> parsed = (Map<String, Object>) JSON.deserializeUntyped(
      res.getBody()
    );
    List<Object> responses = (List<Object>) parsed.get('responses');
    List<String> failures = new List<String>();
    for (Object responseObj : responses) {
      Map<String, Object> singleResponse = (Map<String, Object>) responseObj;
      Integer status = (Integer) singleResponse.get('status');
      if (status == null || status >= 300) {
        failures.add(describeBatchFailure(singleResponse, status));
      }
    }

    if (!failures.isEmpty()) {
      throw new TeamsSwarmException(
        'Some chat members failed to add: ' + String.join(failures, '; ')
      );
    }
  }

  /**
   * Current members of a swarm chat. removalId is the chat-specific conversationMember id
   * returned here, NOT the user's object id or UPN - DELETE /chats/{id}/members/{id} needs
   * that membership id, unlike group removal which uses the object id directly.
   */
  public static List<MemberInfo> listChatMembers(String chatId) {
    HttpRequest req = buildRequest('/v1.0/chats/' + chatId + '/members', 'GET');
    HttpResponse res = new Http().send(req);

    if (res.getStatusCode() != 200) {
      throw new TeamsSwarmException(
        'Failed to list chat members: ' +
          res.getStatusCode() +
          ' ' +
          res.getBody()
      );
    }

    Map<String, Object> parsed = (Map<String, Object>) JSON.deserializeUntyped(
      res.getBody()
    );
    List<Object> values = (List<Object>) parsed.get('value');
    List<MemberInfo> members = new List<MemberInfo>();
    if (values == null) {
      return members;
    }
    for (Object valueObj : values) {
      Map<String, Object> value = (Map<String, Object>) valueObj;
      MemberInfo info = new MemberInfo();
      info.removalId = (String) value.get('id');
      info.displayName = (String) value.get('displayName');
      info.email = (String) value.get('email');
      List<Object> roles = (List<Object>) value.get('roles');
      info.isOwner = roles != null && roles.contains('owner');
      members.add(info);
    }
    return members;
  }

  /**
   * Needs Chat.ReadWrite.All (already granted - see README.md section 1). 404 means the
   * member is already gone - same end state, not an error.
   */
  public static void removeChatMember(String chatId, String membershipId) {
    if (String.isBlank(membershipId)) {
      throw new TeamsSwarmException(
        'Cannot remove a chat member without a membership id.'
      );
    }

    HttpRequest req = buildRequest(
      '/v1.0/chats/' + chatId + '/members/' + membershipId,
      'DELETE'
    );
    HttpResponse res = new Http().send(req);

    if (res.getStatusCode() != 204 && res.getStatusCode() != 404) {
      throw new TeamsSwarmException(
        'Failed to remove chat member ' +
          membershipId +
          ': ' +
          res.getStatusCode() +
          ' ' +
          res.getBody()
      );
    }
  }

  /**
   * Installs the case-swarm bot (see TeamsBotMessagingResource) into a chat so it can post
   * the interactive case card. Teams delivers a conversationUpdate to the bot's messaging
   * endpoint once this completes, which is what actually triggers the first card post - see
   * TeamsBotMessagingResource.handleBotInstalled. teamsAppCatalogId is
   * Teams_Bot_Config__mdt.Default.Teams_App_Catalog_Id__c, the id of this bot's custom Teams
   * app once uploaded to the org's app catalog (README.md "Bot Framework registration").
   */
  public class ChatMessageResult {
    public String id;
    public String body;
    public String senderDisplayName;
    public String senderEmail;
    /** True when Graph from.application is set (bot / Teams app), not a user. */
    public Boolean isApplication;
    public Datetime createdDateTime;
  }

  /**
   * Posts a plain-text message into a Teams group chat via Graph.
   * NOTE: Graph rejects application-only POST /chats/{id}/messages with 401 except for
   * migration scenarios. Prefer TeamsBotConversationService.sendText for the chat bridge.
   */
  public static ChatMessageResult sendChatMessage(
    String chatId,
    String content
  ) {
    if (String.isBlank(chatId)) {
      throw new TeamsSwarmException(
        'chatId is required to send a chat message.'
      );
    }
    if (String.isBlank(content)) {
      throw new TeamsSwarmException('Message content is required.');
    }

    Map<String, Object> body = new Map<String, Object>{
      'body' => new Map<String, Object>{
        'contentType' => 'text',
        'content' => content
      }
    };

    HttpRequest req = buildRequest(
      '/v1.0/chats/' + chatId + '/messages',
      'POST'
    );
    req.setBody(JSON.serialize(body));
    HttpResponse res = new Http().send(req);

    if (res.getStatusCode() != 201) {
      throw new TeamsSwarmException(
        'Failed to send chat message: ' +
          res.getStatusCode() +
          ' ' +
          res.getBody() +
          ' (Graph application auth cannot send live chat messages - use Bot Framework.)'
      );
    }

    return parseChatMessage(
      (Map<String, Object>) JSON.deserializeUntyped(res.getBody())
    );
  }

  /**
   * Lists recent messages in a chat (Graph returns newest first by default for this collection).
   */
  public static List<ChatMessageResult> listChatMessages(
    String chatId,
    Integer top
  ) {
    if (String.isBlank(chatId)) {
      throw new TeamsSwarmException(
        'chatId is required to list chat messages.'
      );
    }
    Integer pageSize = top == null || top <= 0 ? 50 : Math.min(top, 50);

    HttpRequest req = buildRequest(
      '/v1.0/chats/' + chatId + '/messages?$top=' + pageSize,
      'GET'
    );
    HttpResponse res = new Http().send(req);

    if (res.getStatusCode() != 200) {
      throw new TeamsSwarmException(
        'Failed to list chat messages: ' +
          res.getStatusCode() +
          ' ' +
          res.getBody()
      );
    }

    Map<String, Object> parsed = (Map<String, Object>) JSON.deserializeUntyped(
      res.getBody()
    );
    List<Object> values = (List<Object>) parsed.get('value');
    List<ChatMessageResult> messages = new List<ChatMessageResult>();
    if (values == null) {
      return messages;
    }
    for (Object valueObj : values) {
      messages.add(parseChatMessage((Map<String, Object>) valueObj));
    }
    return messages;
  }

  private static ChatMessageResult parseChatMessage(Map<String, Object> raw) {
    ChatMessageResult result = new ChatMessageResult();
    result.id = (String) raw.get('id');

    Object bodyObj = raw.get('body');
    if (bodyObj instanceof Map<String, Object>) {
      result.body = stripHtml(
        (String) ((Map<String, Object>) bodyObj).get('content')
      );
    }

    Object fromObj = raw.get('from');
    if (fromObj instanceof Map<String, Object>) {
      Map<String, Object> fromMap = (Map<String, Object>) fromObj;
      Object userObj = fromMap.get('user');
      Object appObj = fromMap.get('application');
      if (userObj instanceof Map<String, Object>) {
        Map<String, Object> user = (Map<String, Object>) userObj;
        result.senderDisplayName = (String) user.get('displayName');
        String email = (String) user.get('email');
        if (String.isBlank(email)) {
          email = (String) user.get('userPrincipalName');
        }
        // Only keep values that look like emails — Sender_Aad_Email__c is an Email field.
        if (String.isNotBlank(email) && email.contains('@')) {
          result.senderEmail = email;
        }
      } else if (appObj instanceof Map<String, Object>) {
        Map<String, Object> app = (Map<String, Object>) appObj;
        result.senderDisplayName = (String) app.get('displayName');
        result.isApplication = true;
      }
    }

    String created = (String) raw.get('createdDateTime');
    if (String.isNotBlank(created)) {
      // Graph returns ISO-8601 e.g. 2024-01-15T12:34:56.789Z
      result.createdDateTime = (Datetime) JSON.deserialize(
        '"' + created + '"',
        Datetime.class
      );
    }
    return result;
  }

  private static String stripHtml(String html) {
    if (String.isBlank(html)) {
      return html;
    }
    return html.replaceAll('<[^>]+>', '').unescapeHtml4().trim();
  }

  /**
   * Install the Case Swarm Teams app into a chat. Manifest 1.0.1+ declares
   * ChatMessage.Read.Chat RSC so the bot can receive all group-chat messages
   * (not only @mentions). Graph then requires:
   * 1) consentedPermissionSet in this POST body matching the app definition, and
   * 2) TeamsAppInstallation.ReadWriteAndConsentForChat.All on the MS_Graph app
   *    (ReadWriteForChat.All alone cannot consent RSC — see Graph chat-post-installedapps).
   */
  public static void installBotApp(String chatId, String teamsAppCatalogId) {
    if (String.isBlank(teamsAppCatalogId)) {
      throw new TeamsSwarmException(
        'Teams_Bot_Config__mdt.Default.Teams_App_Catalog_Id__c is not configured.'
      );
    }

    Map<String, Object> rscPerm = new Map<String, Object>{
      'permissionValue' => 'ChatMessage.Read.Chat',
      'permissionType' => 'Application'
    };
    Map<String, Object> body = new Map<String, Object>{
      'teamsApp@odata.bind' => 'https://graph.microsoft.com/v1.0/appCatalogs/teamsApps/' +
      teamsAppCatalogId,
      'consentedPermissionSet' => new Map<String, Object>{
        'resourceSpecificPermissions' => new List<Object>{ rscPerm }
      }
    };

    HttpRequest req = buildRequest(
      '/v1.0/chats/' + chatId + '/installedApps',
      'POST'
    );
    req.setBody(JSON.serialize(body));
    HttpResponse res = new Http().send(req);

    // 409 means the app is already installed in this chat - not an error.
    if (res.getStatusCode() != 201 && res.getStatusCode() != 409) {
      throw new TeamsSwarmException(
        'Failed to install bot app into chat ' +
          chatId +
          ': ' +
          res.getStatusCode() +
          ' ' +
          res.getBody()
      );
    }
  }

  /**
   * Soft-delete a group chat, used by End Chat once the transcript is on the Case.
   * The chat disappears from every member's Teams client; a tenant admin can restore it
   * for seven days (Graph also rate-limits this to one delete per second per tenant).
   *
   * Needs Chat.ManageDeletion.All application consent on the MS_Graph app registration -
   * none of the other permissions this integration already uses cover deletion, so an
   * un-consented tenant gets a 403 here while everything else keeps working.
   */
  public static void deleteChat(String chatId) {
    if (String.isBlank(chatId)) {
      throw new TeamsSwarmException(
        'Cannot delete a Teams chat without a chat id.'
      );
    }

    HttpRequest req = buildRequest('/v1.0/chats/' + chatId, 'DELETE');
    HttpResponse res = new Http().send(req);

    // 404 means the chat is already gone - same end state, not an error.
    if (res.getStatusCode() != 204 && res.getStatusCode() != 404) {
      throw new TeamsSwarmException(
        'Failed to delete chat ' +
          chatId +
          ': ' +
          res.getStatusCode() +
          ' ' +
          res.getBody()
      );
    }
  }

  /** Surfaces Graph's actual error message/code from a failed $batch sub-response, not just its status - the status alone ("403") isn't enough to diagnose why. */
  private static String describeBatchFailure(
    Map<String, Object> singleResponse,
    Integer status
  ) {
    String detail = '';
    Object bodyObj = singleResponse.get('body');
    if (bodyObj instanceof Map<String, Object>) {
      Object errorObj = ((Map<String, Object>) bodyObj).get('error');
      if (errorObj instanceof Map<String, Object>) {
        Map<String, Object> error = (Map<String, Object>) errorObj;
        detail = ' (' + error.get('code') + ': ' + error.get('message') + ')';
      }
    }
    return 'request ' +
      singleResponse.get('id') +
      ' failed with status ' +
      status +
      detail;
  }

  /**
   * roles must be a non-empty list - Graph's /chats/{id}/members rejects both an omitted and
   * an explicitly empty roles array ("Each chat member must have at least one role specified.
   * Supported roles are 'owner' and 'guest'"), confirmed against a real tenant. There's no
   * third "regular member" value; 'guest' is Graph's only non-owner role for this endpoint,
   * regardless of whether the person is actually external to the tenant. If that turns out to
   * make Teams show a visible "Guest" label for same-tenant members, that's a cosmetic side
   * effect of this API constraint, not a real access change - the person is still added via
   * the same Graph identity either way.
   */
  private static Map<String, Object> chatMemberPayload(
    String memberIdentifier,
    Boolean isOwner
  ) {
    return new Map<String, Object>{
      '@odata.type' => '#microsoft.graph.aadUserConversationMember',
      'roles' => new List<String>{ isOwner ? 'owner' : 'guest' },
      'user@odata.bind' => 'https://graph.microsoft.com/v1.0/users(\'' +
      memberIdentifier +
      '\')'
    };
  }

  private static HttpRequest buildRequest(String path, String method) {
    HttpRequest req = new HttpRequest();
    req.setEndpoint('callout:' + NAMED_CREDENTIAL + path);
    req.setMethod(method);
    req.setHeader('Content-Type', 'application/json');
    req.setTimeout(60000);
    return req;
  }
}
