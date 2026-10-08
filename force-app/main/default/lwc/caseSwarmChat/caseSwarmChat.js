import { LightningElement, api } from 'lwc';

export default class CaseSwarmChat extends LightningElement {
    @api recordId;

    handleEndChat() {
        const core = this.template.querySelector('c-case-swarm-chat-core');
        if (core && typeof core.endChat === 'function') {
            core.endChat();
        }
    }
}
