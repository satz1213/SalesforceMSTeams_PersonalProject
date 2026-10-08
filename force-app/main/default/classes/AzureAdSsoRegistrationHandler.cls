/**
 * Registration Handler for the "Login with Microsoft" Auth Provider (Azure_AD_SSO), part of the
 * "Salesforce in Teams" per-user login flow. Salesforce's Auth Provider detail page for an OpenID
 * Connect provider doesn't expose an "Existing User Linking URL" the way some other provider types
 * (e.g. Facebook) do - confirmed by looking at the live page for this provider, not assumed - so
 * manual account linking isn't an option here. This Registration Handler is the replacement: it
 * runs on a person's first login via this provider and must resolve them to one of this org's
 * existing Users (never auto-provision a new one - every real user here already exists).
 *
 * Matches on Azure_AD_Email_Id__c, the same field this org already uses everywhere else to bridge
 * a person's Microsoft/Teams identity to their Salesforce User (see CLAUDE.md's "Identity
 * bridging" section - Case Swarm, MessagingSession chat, etc. all key off this same field), rather
 * than introducing a second, parallel identity convention just for this login path.
 *
 * Checks both the incoming email and username claims (whichever Salesforce actually populates for
 * this tenant/scope combination isn't confirmed without a live login test) so a mismatch there
 * doesn't silently block login.
 *
 * On success, Salesforce automatically creates a ThirdPartyAccountLink between this external
 * identity and the returned User, so createUser() only runs once per person - later logins call
 * updateUser() instead.
 */
public class AzureAdSsoRegistrationHandler implements Auth.RegistrationHandler {

    public class NoLinkedUserException extends Exception {}

    public User createUser(Id portalId, Auth.UserData data) {
        String identifier = String.isNotBlank(data.email) ? data.email : data.username;
        if (String.isBlank(identifier)) {
            throw new NoLinkedUserException('Microsoft did not return an email or username for this sign-in.');
        }

        List<User> matches = [
            SELECT Id
            FROM User
            WHERE Azure_AD_Email_Id__c = :identifier AND IsActive = true
            LIMIT 1
        ];
        if (matches.isEmpty()) {
            throw new NoLinkedUserException(
                'No active Salesforce user has Azure_AD_Email_Id__c set to "' + identifier + '". ' +
                'Ask your Salesforce admin to set that field on your User record, then sign in again.'
            );
        }
        return matches[0];
    }

    public void updateUser(Id userId, Id portalId, Auth.UserData data) {
        // Nothing to sync back to the Salesforce User on subsequent logins - identity is
        // established, that's all this login flow needs.
    }
}
