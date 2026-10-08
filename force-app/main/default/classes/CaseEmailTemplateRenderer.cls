/**
 * Wraps Messaging.renderStoredEmailTemplate() so the "Salesforce in Teams" record page can merge
 * an EmailTemplate against the open Case (and its Contact, for recipient-specific merge fields)
 * without sending anything - confirmed live that this method resolves real merge fields (e.g.
 * {!Case.CaseNumber}) correctly. The person reviews the merged Subject/Body in the compose modal
 * and sends it themselves via Outlook (a mailto: handoff) - this class never sends an email.
 *
 * Exposed as an Invocable Method, reachable via the same Invocable Actions REST API already used
 * for CaseReasonUpdateAuto.flow-meta.xml (/services/data/vNN/actions/custom/apex/
 * CaseEmailTemplateRenderer) - Apex here instead of a Flow because the HTML-to-plain-text
 * fallback below needs real code, not just a declarative record read.
 */
public with sharing class CaseEmailTemplateRenderer {
    public class RenderRequest {
        @InvocableVariable(required=true)
        public Id templateId;
        @InvocableVariable(required=true)
        public Id relatedRecordId; // the Case - drives {!Case.X} merge fields

        @InvocableVariable
        public Id targetObjectId; // the Contact/Lead/User - drives {!Contact.X} merge fields
    }

    public class RenderResult {
        @InvocableVariable
        public String subject;

        @InvocableVariable
        public String body; // always plain text - an HTML template's body is tag-stripped, since
                             // the eventual destination (a mailto: link) can't render HTML anyway
    }

    @InvocableMethod(label='Render Email Template for Case' description='Merges an EmailTemplate against a record without sending anything.')
    public static List<RenderResult> render(List<RenderRequest> requests) {
        List<RenderResult> results = new List<RenderResult>();
        for (RenderRequest req : requests) {
            Messaging.SingleEmailMessage merged = Messaging.renderStoredEmailTemplate(
                req.templateId, req.targetObjectId, req.relatedRecordId
            );
            RenderResult r = new RenderResult();
            r.subject = merged.getSubject();
            String plain = merged.getPlainTextBody();
            if (String.isBlank(plain) && String.isNotBlank(merged.getHtmlBody())) {
                plain = stripHtml(merged.getHtmlBody());
            }
            r.body = plain;
            results.add(r);
        }
        return results;
    }

    private static String stripHtml(String html) {
        String text = html.replaceAll('(?i)<br\\s*/?>', '\n');
        text = text.replaceAll('(?i)</p>', '\n\n');
        text = text.replaceAll('<[^>]+>', '');
        text = text.replace('&nbsp;', ' ').replace('&amp;', '&').replace('&lt;', '<').replace('&gt;', '>');
        return text.trim();
    }
}
