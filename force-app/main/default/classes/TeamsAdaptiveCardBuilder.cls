/**
 * Builds the Adaptive Card JSON posted into a case's swarm chat, and the
 * inline edit form it flips to when a participant clicks "Edit Case".
 * Pure JSON construction, no callouts/DML - keeps TeamsBotMessagingResource
 * (which does the callouts) easy to test independently of card layout.
 *
 * Cards use the Adaptive Card Universal Action model (Action.Execute), which
 * only round-trips through a Bot Framework messaging endpoint - see
 * TeamsBotMessagingResource. A card posted via a plain Graph API message
 * (no bot) cannot do this; its buttons are limited to Action.OpenUrl.
 */
public with sharing class TeamsAdaptiveCardBuilder {
    private static final String SCHEMA = 'http://adaptivecards.io/schemas/adaptive-card.json';
    private static final String VERSION = '1.5';

    public class CaseCardData {
        public Id caseId;
        public String caseNumber;
        public String subject;
        public String description;
        public String status;
        public String priority;
        public Id ownerId;
        public String ownerName;
    }

    public class OwnerOption {
        public Id userId;
        public String name;
    }

    /** Read-only summary card with an "Edit Case" button. */
    public static Map<String, Object> buildViewCard(CaseCardData data) {
        List<Object> facts = new List<Object>{
            fact('Status', data.status),
            fact('Priority', data.priority),
            fact('Owner', data.ownerName)
        };

        List<Object> body = new List<Object>{
            textBlock('Case ' + data.caseNumber, 'Medium', 'Bolder', null),
            textBlock(data.subject, 'Default', 'Default', null),
            new Map<String, Object>{ 'type' => 'FactSet', 'facts' => facts }
        };
        if (String.isNotBlank(data.description)) {
            body.add(textBlock(data.description, 'Small', 'Default', true));
        }

        List<Object> actions = new List<Object>{
            executeAction('Edit Case', 'edit', data.caseId),
            new Map<String, Object>{ 'type' => 'Action.OpenUrl', 'title' => 'Open in Salesforce', 'url' => salesforceUrl(data.caseId) }
        };

        return card(body, actions);
    }

    /** Inline edit form: choice sets for picklists/owner, text inputs for free text. */
    public static Map<String, Object> buildEditCard(CaseCardData data, List<String> statusOptions, List<String> priorityOptions, List<OwnerOption> ownerOptions) {
        List<Object> body = new List<Object>{
            textBlock('Edit Case ' + data.caseNumber, 'Medium', 'Bolder', null),
            choiceSet('status', 'Status', data.status, statusOptions),
            choiceSet('priority', 'Priority', data.priority, priorityOptions),
            ownerChoiceSet(data.ownerId, ownerOptions),
            new Map<String, Object>{ 'type' => 'Input.Text', 'id' => 'subject', 'label' => 'Subject', 'value' => data.subject },
            new Map<String, Object>{ 'type' => 'Input.Text', 'id' => 'description', 'label' => 'Description', 'value' => data.description, 'isMultiline' => true }
        };

        List<Object> actions = new List<Object>{
            executeAction('Save', 'save', data.caseId),
            executeAction('Cancel', 'cancel', data.caseId)
        };

        return card(body, actions);
    }

    private static Map<String, Object> card(List<Object> body, List<Object> actions) {
        return new Map<String, Object>{
            'type' => 'AdaptiveCard',
            '$schema' => SCHEMA,
            'version' => VERSION,
            'body' => body,
            'actions' => actions
        };
    }

    private static Map<String, Object> textBlock(String text, String size, String weight, Object isSubtle) {
        Map<String, Object> block = new Map<String, Object>{ 'type' => 'TextBlock', 'text' => text, 'wrap' => true, 'size' => size, 'weight' => weight };
        if (isSubtle != null) {
            block.put('isSubtle', isSubtle);
        }
        return block;
    }

    private static Map<String, Object> fact(String title, String value) {
        return new Map<String, Object>{ 'title' => title, 'value' => String.isBlank(value) ? '-' : value };
    }

    private static Map<String, Object> choiceSet(String id, String label, String currentValue, List<String> options) {
        List<Object> choices = new List<Object>();
        for (String option : options) {
            choices.add(new Map<String, Object>{ 'title' => option, 'value' => option });
        }
        return new Map<String, Object>{
            'type' => 'Input.ChoiceSet',
            'id' => id,
            'label' => label,
            'value' => currentValue,
            'style' => 'compact',
            'choices' => choices
        };
    }

    private static Map<String, Object> ownerChoiceSet(Id currentOwnerId, List<OwnerOption> ownerOptions) {
        List<Object> choices = new List<Object>();
        for (OwnerOption option : ownerOptions) {
            choices.add(new Map<String, Object>{ 'title' => option.name, 'value' => String.valueOf(option.userId) });
        }
        return new Map<String, Object>{
            'type' => 'Input.ChoiceSet',
            'id' => 'ownerId',
            'label' => 'Owner',
            'value' => String.valueOf(currentOwnerId),
            'style' => 'compact',
            'choices' => choices
        };
    }

    private static Map<String, Object> executeAction(String title, String verb, Id caseId) {
        return new Map<String, Object>{
            'type' => 'Action.Execute',
            'title' => title,
            'verb' => verb,
            'data' => new Map<String, Object>{ 'caseId' => String.valueOf(caseId) }
        };
    }

    private static String salesforceUrl(Id caseId) {
        return URL.getOrgDomainUrl().toExternalForm() + '/' + caseId;
    }
}
