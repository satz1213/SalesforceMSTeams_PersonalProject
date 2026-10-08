/**
 * Note for future test-writing: MessagingSession.Status cannot be changed via plain update DML
 * (confirmed: "Field is not writeable: MessagingSession.Status" when tried) - Omni-Channel's own
 * routing/presence engine owns that transition, not arbitrary Apex. It's settable at insert only.
 * That means this trigger's Waiting -> Active path can't be exercised by ordinary test DML;
 * MessagingSessionTeamsChatHandlerTest instead calls handleAfterUpdate() directly with
 * hand-built before/after MessagingSession records, which is exactly why that method exists as
 * a plain static method rather than logic inlined here.
 */
trigger MessagingSessionTrigger on MessagingSession (after update) {
    MessagingSessionTeamsChatHandler.handleAfterUpdate(Trigger.new, Trigger.oldMap);
}
