/**
 * Creates a REAL Microsoft Teams meeting + calendar invite via Microsoft Graph, on behalf of the
 * signed-in Teams user - the direct-Graph alternative to the Outlook deep link in
 * salesforceTabRecordFull.js's Schedule Expert Call flow. No popup, no "click Send yourself" step -
 * this actually sends the invite.
 *
 * Auth: the tab gets a Teams SSO token via microsoftTeams.authentication.getAuthToken() (this app
 * already exposes an API for this - see teamsapp-salesforce/manifest.json's webApplicationInfo,
 * built for the Salesforce Token Exchange SSO flow in salesforceTabHome.js and reused here for a
 * different purpose) and sends it here. This relay exchanges it for a Microsoft Graph access token
 * via the standard On-Behalf-Of (OBO) flow (POST to Microsoft's own token endpoint,
 * grant_type=...jwt-bearer), using this app's own client secret - the one genuinely new thing this
 * flow needs that nothing else in this project required (Salesforce's Token Exchange only validates
 * the Teams SSO token's signature against Microsoft's public JWKS, no secret needed for that - OBO
 * is different, it genuinely requires a confidential client).
 *
 * Required Entra setup (one-time, by a tenant admin) before this works at all - two separate layers:
 * 1. Teams SSO itself (getAuthToken()) needs to actually be fully working first - see
 *    salesforceTabHome.js's loginWithTeamsSso() comment: this was built but never confirmed working
 *    end-to-end in this org. If THAT fails, nothing below even gets attempted.
 * 2. On app b186fa34-7fdf-48be-80c3-7e736eb501b3 (Entra admin center - App registrations - API
 *    permissions), add the delegated Microsoft Graph permission Calendars.ReadWrite and grant admin
 *    consent - this alone is sufficient per Microsoft's own docs (no separate Teams/OnlineMeetings
 *    permission needed for isOnlineMeeting/onlineMeetingProvider). Then Certificates & secrets on
 *    that same app - new client secret, its VALUE goes into this Function App's settings as
 *    TEAMS_SSO_CLIENT_SECRET below.
 * Until both layers are done, this returns a clear, specific error instead of a cryptic OAuth
 * failure - see the invalid_grant/interaction_required/consent_required handling below.
 *
 * Settings: TEAMS_SSO_CLIENT_SECRET. Tenant/client id are hardcoded below, matching the same real,
 * already-live ids used (unsecreted) in SalesforceInTeamsTokenExchangeHandler.cls and the Teams
 * manifest - not new values invented for this file.
 */
const { app } = require('@azure/functions');

const TENANT_ID = '80040ab0-138a-4eaa-8a1c-68e4f0465151';
const CLIENT_ID = 'b186fa34-7fdf-48be-80c3-7e736eb501b3'; // same app as webApplicationInfo in the manifest
const MAX_TEXT_LENGTH = 4000;

app.http('salesforceCreateCalendarInvite', {
  methods: ['POST'],
  authLevel: 'anonymous',
  handler: async (request, context) => {
    const clientSecret = process.env.TEAMS_SSO_CLIENT_SECRET;
    if (!clientSecret) {
      context.error('TEAMS_SSO_CLIENT_SECRET app setting is not configured.');
      return { status: 500, jsonBody: { error: 'Calendar invite creation is not configured on the relay yet.' } };
    }

    let body;
    try {
      body = await request.json();
    } catch (e) {
      return { status: 400, jsonBody: { error: 'Invalid JSON body.' } };
    }

    const ssoToken = (body && body.ssoToken) || '';
    const subject = ((body && body.subject) || '').toString().slice(0, 255);
    const startIso = (body && body.startIso) || '';
    const endIso = (body && body.endIso) || '';
    const attendeeEmail = (body && body.attendeeEmail) || '';
    const bodyText = ((body && body.bodyText) || '').toString().slice(0, MAX_TEXT_LENGTH);
    const timeZone = (body && body.timeZone) || 'UTC';
    if (!ssoToken || !subject || !startIso || !endIso || !attendeeEmail) {
      return { status: 400, jsonBody: { error: 'ssoToken, subject, startIso, endIso, and attendeeEmail are required.' } };
    }

    try {
      // Step 1: On-Behalf-Of exchange - the Teams SSO token (scoped to THIS app) swapped for a
      // Microsoft Graph access token, still as the same signed-in user, not an app-only token.
      const oboBody = new URLSearchParams();
      oboBody.set('grant_type', 'urn:ietf:params:oauth:grant-type:jwt-bearer');
      oboBody.set('client_id', CLIENT_ID);
      oboBody.set('client_secret', clientSecret);
      oboBody.set('assertion', ssoToken);
      oboBody.set('scope', 'https://graph.microsoft.com/Calendars.ReadWrite');
      oboBody.set('requested_token_use', 'on_behalf_of');

      const oboRes = await fetch('https://login.microsoftonline.com/' + TENANT_ID + '/oauth2/v2.0/token', {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: oboBody.toString()
      });
      const oboData = await oboRes.json();
      if (!oboRes.ok) {
        context.error('Graph OBO exchange failed:', JSON.stringify(oboData));
        // invalid_grant/interaction_required/consent_required - the Entra admin step above hasn't
        // been done (or granted consent hasn't propagated yet) - give a specific, actionable message
        // instead of a raw OAuth error code the agent can't act on.
        const errCode = oboData && oboData.error;
        if (errCode === 'invalid_grant' || errCode === 'interaction_required' || errCode === 'consent_required') {
          return { status: 403, jsonBody: { error: 'Calendar access has not been consented to yet for this app - an admin needs to grant the Calendars.ReadWrite permission in Entra first (see this file\'s header comment).' } };
        }
        return { status: 502, jsonBody: { error: 'Could not get Microsoft Graph access.' } };
      }
      const graphToken = oboData.access_token;

      // Step 2: create the event - isOnlineMeeting + onlineMeetingProvider makes Graph generate a
      // real Teams meeting as part of this same call (confirmed against Microsoft's own docs:
      // Calendars.ReadWrite alone is the documented requirement, nothing extra needed for that).
      const eventRes = await fetch('https://graph.microsoft.com/v1.0/me/events', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + graphToken },
        body: JSON.stringify({
          subject: subject,
          body: { contentType: 'text', content: bodyText },
          start: { dateTime: startIso, timeZone: timeZone },
          end: { dateTime: endIso, timeZone: timeZone },
          attendees: [{ emailAddress: { address: attendeeEmail }, type: 'required' }],
          isOnlineMeeting: true,
          onlineMeetingProvider: 'teamsForBusiness'
        })
      });
      const eventData = await eventRes.json();
      if (!eventRes.ok) {
        context.error('Graph event creation failed:', JSON.stringify(eventData));
        return { status: 502, jsonBody: { error: (eventData && eventData.error && eventData.error.message) || 'Could not create the calendar event.' } };
      }

      return {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
        jsonBody: {
          webLink: eventData.webLink || null,
          joinUrl: (eventData.onlineMeeting && eventData.onlineMeeting.joinUrl) || null
        }
      };
    } catch (err) {
      context.error('Failed to create calendar invite:', err);
      return { status: 502, jsonBody: { error: 'Could not create the calendar invite right now.' } };
    }
  }
});
