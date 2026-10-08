/**
 * Fires when an Omni-Channel agent accepts a Messaging chat (Status -> Active) and kicks off
 * creation of a plain 1:1 Teams group chat between that agent and the customer - no Case, no
 * Adaptive Card, just a Teams conversation. See MessagingSessionTeamsChatQueueable for why this
 * is deferred to async: Apex forbids a callout after DML, and this trigger's own transaction
 * still has this record's update pending.
 *
 * Guards below are what make this idempotent across re-fires of the same MessagingSession
 * (Paused -> Active resume, ownership transfer, requeue): Teams_Chat_Id__c already set means a
 * chat already exists for this session, so skip regardless of what the Status transition was.
 */
public class MessagingSessionTeamsChatHandler {
    public static void handleAfterUpdate(List<MessagingSession> newRecords, Map<Id, MessagingSession> oldMap) {
        for (MessagingSession session : newRecords) {
            MessagingSession previous = oldMap.get(session.Id);
            Boolean justBecameActive = session.Status == 'Active' && previous.Status != 'Active';
            if (!justBecameActive || String.isNotBlank(session.Teams_Chat_Id__c)) {
                continue;
            }
            if (String.isBlank(session.User__c)) {
                System.debug(LoggingLevel.WARN, 'MessagingSession ' + session.Id + ' went Active with no User__c (customer) populated - skipping Teams chat creation.');
                continue;
            }
            // OwnerId is polymorphic (Group before acceptance, User after) - '005' is the User key prefix.
            if (session.OwnerId == null || !String.valueOf(session.OwnerId).startsWith('005')) {
                System.debug(LoggingLevel.WARN, 'MessagingSession ' + session.Id + ' OwnerId is not a User - skipping Teams chat creation.');
                continue;
            }
            System.enqueueJob(new MessagingSessionTeamsChatQueueable(session.Id, session.OwnerId, session.User__c));
        }
    }
}
