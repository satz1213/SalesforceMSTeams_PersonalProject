/**
 * Deletes the Teams chat behind a Chat swarm, on behalf of TeamsSwarmChatController.endChat.
 * Deferred to its own async transaction because endChat has to write the Swarm_Message__c
 * transcript (DML) before the chat can go away, and Apex forbids a callout after DML - so
 * the delete cannot run inline no matter how it's ordered. The chat id is passed in rather
 * than re-read from the Case, since endChat clears Swarm_Team_Id__c in the same transaction
 * that enqueues this job.
 *
 * Graph's delete is a soft delete: the chat vanishes from every member's Teams client but a
 * tenant admin can restore it for seven days. A failure here - most often missing
 * Chat.ManageDeletion.All consent on the MS_Graph app - leaves the chat in Teams and is
 * recorded on Swarm_Chat_Delete_Error__c rather than surfaced to the agent, because the
 * transcript is already committed and the Case is already reset by then.
 */
public class TeamsSwarmChatDeleteQueueable implements Queueable, Database.AllowsCallouts {
  private final Id caseId;
  private final String chatId;

  public TeamsSwarmChatDeleteQueueable(Id caseId, String chatId) {
    this.caseId = caseId;
    this.chatId = chatId;
  }

  public void execute(QueueableContext context) {
    Case matchingCase = new Case(Id = caseId);
    try {
      TeamsSwarmService.deleteChat(chatId);
      matchingCase.Swarm_Chat_Delete_Error__c = null;
    } catch (Exception e) {
      matchingCase.Swarm_Chat_Delete_Error__c = truncate(e.getMessage(), 4096);
    }
    update matchingCase;
  }

  private static String truncate(String value, Integer maxLength) {
    return value == null ||
      value.length() <= maxLength
      ? value
      : value.substring(0, maxLength);
  }
}
