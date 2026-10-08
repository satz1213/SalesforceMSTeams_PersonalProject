@IsTest
private class TeamsAdaptiveCardBuilderTest {
    private static TeamsAdaptiveCardBuilder.CaseCardData sampleData() {
        TeamsAdaptiveCardBuilder.CaseCardData data = new TeamsAdaptiveCardBuilder.CaseCardData();
        data.caseId = fakeId(Case.SObjectType);
        data.caseNumber = '00001234';
        data.subject = 'Printer on fire';
        data.description = 'Smoke coming from the tray';
        data.status = 'New';
        data.priority = 'High';
        data.ownerId = fakeId(User.SObjectType);
        data.ownerName = 'Jordan Agent';
        return data;
    }

    private static Id fakeId(Schema.SObjectType sObjType) {
        String keyPrefix = sObjType.getDescribe().getKeyPrefix();
        return Id.valueOf(keyPrefix + '0'.repeat(15 - keyPrefix.length()));
    }

    @IsTest
    static void viewCardIncludesFactsAndEditAction() {
        Test.startTest();
        Map<String, Object> cardMap = TeamsAdaptiveCardBuilder.buildViewCard(sampleData());
        Test.stopTest();

        System.assertEquals('AdaptiveCard', cardMap.get('type'));

        List<Object> actions = (List<Object>) cardMap.get('actions');
        Map<String, Object> editAction = (Map<String, Object>) actions[0];
        System.assertEquals('Action.Execute', editAction.get('type'));
        System.assertEquals('edit', editAction.get('verb'));

        List<Object> body = (List<Object>) cardMap.get('body');
        Map<String, Object> factSet;
        for (Object item : body) {
            Map<String, Object> block = (Map<String, Object>) item;
            if (block.get('type') == 'FactSet') {
                factSet = block;
            }
        }
        System.assertNotEquals(null, factSet, 'Expected a FactSet block summarizing the case');
        System.assertEquals(3, ((List<Object>) factSet.get('facts')).size());
    }

    @IsTest
    static void viewCardOmitsDescriptionBlockWhenBlank() {
        TeamsAdaptiveCardBuilder.CaseCardData data = sampleData();
        data.description = null;

        Test.startTest();
        Map<String, Object> cardMap = TeamsAdaptiveCardBuilder.buildViewCard(data);
        Test.stopTest();

        List<Object> body = (List<Object>) cardMap.get('body');
        System.assertEquals(3, body.size());
    }

    @IsTest
    static void editCardIncludesChoiceSetsAndSaveCancelActions() {
        List<TeamsAdaptiveCardBuilder.OwnerOption> owners = new List<TeamsAdaptiveCardBuilder.OwnerOption>();
        TeamsAdaptiveCardBuilder.OwnerOption owner = new TeamsAdaptiveCardBuilder.OwnerOption();
        owner.userId = fakeId(User.SObjectType);
        owner.name = 'Jordan Agent';
        owners.add(owner);

        Test.startTest();
        Map<String, Object> cardMap = TeamsAdaptiveCardBuilder.buildEditCard(
            sampleData(),
            new List<String>{ 'New', 'Working', 'Closed' },
            new List<String>{ 'Low', 'High' },
            owners
        );
        Test.stopTest();

        List<Object> body = (List<Object>) cardMap.get('body');
        Set<String> inputIds = new Set<String>();
        for (Object item : body) {
            Map<String, Object> block = (Map<String, Object>) item;
            if (block.containsKey('id')) {
                inputIds.add((String) block.get('id'));
            }
        }
        System.assert(inputIds.containsAll(new Set<String>{ 'status', 'priority', 'ownerId', 'subject', 'description' }));

        List<Object> actions = (List<Object>) cardMap.get('actions');
        System.assertEquals(2, actions.size());
        System.assertEquals('save', ((Map<String, Object>) actions[0]).get('verb'));
        System.assertEquals('cancel', ((Map<String, Object>) actions[1]).get('verb'));
    }
}
