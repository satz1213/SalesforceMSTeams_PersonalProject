import { LightningElement, api, wire } from 'lwc';
import { getRecord, getFieldValue } from 'lightning/uiRecordApi';
import CASE_SWARM_TEAM_URL from '@salesforce/schema/Case.Swarm_Team_Url__c';
import CASE_SWARM_STATUS from '@salesforce/schema/Case.Swarm_Status__c';
import CASE_SWARM_TYPE from '@salesforce/schema/Case.Swarm_Type__c';

const CASE_FIELDS = [CASE_SWARM_TEAM_URL, CASE_SWARM_STATUS, CASE_SWARM_TYPE];

export default class CaseSwarmTeamsEmbed extends LightningElement {
    @api recordId;
    /** Kept for App Builder compatibility; iframe embed is not supported by Microsoft Teams. */
    @api height = 640;

    @wire(getRecord, { recordId: '$recordId', fields: CASE_FIELDS })
    wiredCase;

    get teamUrl() {
        return getFieldValue(this.wiredCase?.data, CASE_SWARM_TEAM_URL);
    }

    get swarmStatus() {
        return getFieldValue(this.wiredCase?.data, CASE_SWARM_STATUS);
    }

    get swarmType() {
        return getFieldValue(this.wiredCase?.data, CASE_SWARM_TYPE);
    }

    get swarmActive() {
        return this.swarmStatus === 'Active' && !!this.teamUrl;
    }

    get swarmProvisioning() {
        return this.swarmStatus === 'Provisioning';
    }

    get noSwarm() {
        return !this.swarmStatus;
    }

    get swarmTypeLabel() {
        if (this.swarmType === 'Chat') {
            return 'group chat';
        }
        if (this.swarmType === 'Team') {
            return 'Team';
        }
        return 'swarm';
    }

    handleOpenTeams() {
        if (this.teamUrl) {
            window.open(this.teamUrl, '_blank', 'noopener,noreferrer');
        }
    }
}
