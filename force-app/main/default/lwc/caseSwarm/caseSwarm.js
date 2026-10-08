import { LightningElement, api, wire } from "lwc";
import {
  getRecord,
  getFieldValue,
  notifyRecordUpdateAvailable
} from "lightning/uiRecordApi";
import { refreshApex } from "@salesforce/apex";
import { ShowToastEvent } from "lightning/platformShowToastEvent";
import {
  publish,
  subscribe,
  unsubscribe,
  MessageContext,
  APPLICATION_SCOPE
} from "lightning/messageService";
import LightningConfirm from "lightning/confirm";
import CASE_SWARM_REFRESH from "@salesforce/messageChannel/CaseSwarmRefresh__c";
import searchUsers from "@salesforce/apex/TeamsSwarmController.searchUsers";
import startSwarm from "@salesforce/apex/TeamsSwarmController.startSwarm";
import addMembersToSwarm from "@salesforce/apex/TeamsSwarmController.addMembersToSwarm";
import resetSwarm from "@salesforce/apex/TeamsSwarmController.resetSwarm";
import getSwarmMembers from "@salesforce/apex/TeamsSwarmController.getSwarmMembers";
import removeMemberFromSwarm from "@salesforce/apex/TeamsSwarmController.removeMemberFromSwarm";
import endChat from "@salesforce/apex/TeamsSwarmChatController.endChat";

const USAGE_SUMMARY_TIMEOUT_MS = 500;
import CASE_SWARM_TEAM_URL from "@salesforce/schema/Case.Swarm_Team_Url__c";
import CASE_SWARM_STATUS from "@salesforce/schema/Case.Swarm_Status__c";
import CASE_SWARM_TYPE from "@salesforce/schema/Case.Swarm_Type__c";

const CASE_FIELDS = [CASE_SWARM_TEAM_URL, CASE_SWARM_STATUS, CASE_SWARM_TYPE];
const MIN_SEARCH_LENGTH = 2;
const POLL_INTERVAL_MS = 5000;

export default class CaseSwarm extends LightningElement {
  @api recordId;

  searchResults = [];
  selectedMembers = [];
  currentMembers = [];
  isSearching = false;
  isSubmitting = false;
  isResetting = false;
  isEndingChat = false;
  isLoadingMembers = false;
  swarmType = "Team";

  wiredCaseRecord;
  pollIntervalId;
  usageResponseSubscription;
  membersLoaded = false;

  @wire(MessageContext)
  messageContext;

  @wire(getRecord, { recordId: "$recordId", fields: CASE_FIELDS })
  wiredCase(value) {
    this.wiredCaseRecord = value;
    if (value.data) {
      this.syncPolling();
      if (this.swarmActive && !this.membersLoaded) {
        this.loadSwarmMembers();
      }
    }
  }

  disconnectedCallback() {
    this.stopPolling();
    if (this.usageResponseSubscription) {
      unsubscribe(this.usageResponseSubscription);
      this.usageResponseSubscription = null;
    }
  }

  get teamUrl() {
    return getFieldValue(this.wiredCaseRecord?.data, CASE_SWARM_TEAM_URL);
  }

  get swarmStatus() {
    return getFieldValue(this.wiredCaseRecord?.data, CASE_SWARM_STATUS);
  }

  // The Case's actual, persisted swarm type ("Chat" or "Team") - distinct from `swarmType` above,
  // which is this component's own local form state for which type to START a NEW swarm as.
  get persistedSwarmType() {
    return getFieldValue(this.wiredCaseRecord?.data, CASE_SWARM_TYPE);
  }

  get isChatSwarm() {
    return this.persistedSwarmType === "Chat";
  }

  get swarmActive() {
    return this.swarmStatus === "Active";
  }

  get swarmProvisioning() {
    return this.swarmStatus === "Provisioning";
  }

  get swarmFailed() {
    return this.swarmStatus === "Failed";
  }

  get isNewSwarm() {
    return !this.swarmStatus;
  }

  get showResetButton() {
    return !this.isNewSwarm;
  }

  // Chat-swarm-only, same server-side guard TeamsSwarmChatController.endChat itself enforces
  // (requireActiveChatCase) - shown alongside "Clear swarm data", not instead of it: End Chat
  // archives the Teams conversation to Swarm_Message__c first (and best-effort deletes the Teams
  // chat, per Teams_Bot_Config__mdt.Default.Delete_Teams_Chat_On_End__c); Reset just wipes
  // everything - including any existing transcript - with nothing saved and the Teams chat left
  // orphaned. Two genuinely different actions, not a duplicate control.
  get showEndChatButton() {
    return this.swarmActive && this.isChatSwarm;
  }

  get isEndChatDisabled() {
    return this.isEndingChat;
  }

  get showMemberPicker() {
    return this.isNewSwarm || this.swarmActive;
  }

  get submitButtonLabel() {
    return this.isNewSwarm ? "Start swarm" : "Add to swarm";
  }

  get selectedMemberIds() {
    return this.selectedMembers.map((m) => m.userId);
  }

  get isSubmitDisabled() {
    return this.isSubmitting || this.selectedMembers.length === 0;
  }

  get hasSearchResults() {
    return this.searchResults.length > 0;
  }

  get hasSelectedMembers() {
    return this.selectedMembers.length > 0;
  }

  get hasCurrentMembers() {
    return this.currentMembers.length > 0;
  }

  get swarmTypeOptions() {
    return [
      { label: "Quick chat", value: "Chat" },
      { label: "Full Team", value: "Team" }
    ];
  }

  syncPolling() {
    if (this.swarmProvisioning && !this.pollIntervalId) {
      this.pollIntervalId = setInterval(() => {
        refreshApex(this.wiredCaseRecord);
      }, POLL_INTERVAL_MS);
    } else if (!this.swarmProvisioning) {
      this.stopPolling();
    }
  }

  stopPolling() {
    if (this.pollIntervalId) {
      clearInterval(this.pollIntervalId);
      this.pollIntervalId = undefined;
    }
  }

  notifySwarmUi(action) {
    const payload = {
      recordId: this.recordId,
      action,
      swarmType: this.swarmType
    };
    if (this.messageContext) {
      publish(this.messageContext, CASE_SWARM_REFRESH, payload);
    }
    notifyRecordUpdateAvailable([{ recordId: this.recordId }]).catch(() => {
      // Best-effort LDS cache invalidate.
    });
  }

  handleSearchTermChange(event) {
    const term = event.target.value;
    if (!term || term.length < MIN_SEARCH_LENGTH) {
      this.searchResults = [];
      return;
    }

    this.isSearching = true;
    searchUsers({ searchTerm: term })
      .then((results) => {
        const selectedIds = new Set(this.selectedMemberIds);
        this.searchResults = results.filter((r) => !selectedIds.has(r.userId));
      })
      .catch((error) => {
        this.showError("Search failed", error);
      })
      .finally(() => {
        this.isSearching = false;
      });
  }

  handleAddMember(event) {
    const userId = event.currentTarget.dataset.id;
    const user = this.searchResults.find((r) => r.userId === userId);
    if (user) {
      this.selectedMembers = [...this.selectedMembers, user];
      this.searchResults = this.searchResults.filter(
        (r) => r.userId !== userId
      );
    }
  }

  handleRemoveMember(event) {
    const userId = event.currentTarget.dataset.id;
    this.selectedMembers = this.selectedMembers.filter(
      (m) => m.userId !== userId
    );
  }

  handleSwarmTypeChange(event) {
    this.swarmType = event.detail.value;
  }

  handleSubmit() {
    if (this.isNewSwarm) {
      this.startNewSwarm();
    } else {
      this.addMembersToActiveSwarm();
    }
  }

  startNewSwarm() {
    this.isSubmitting = true;
    const startedType = this.swarmType;
    startSwarm({
      caseId: this.recordId,
      memberUserIds: this.selectedMemberIds,
      swarmType: startedType
    })
      .then(async () => {
        const message =
          startedType === "Chat"
            ? "Chat created in Microsoft Teams."
            : "Provisioning your team in Microsoft Teams - this can take a couple of minutes.";
        this.dispatchEvent(
          new ShowToastEvent({
            title: "Swarm started",
            message,
            variant: "success"
          })
        );
        this.selectedMembers = [];
        // Refresh this component's Case wire first, then notify sibling chat UIs.
        await refreshApex(this.wiredCaseRecord);
        await notifyRecordUpdateAvailable([{ recordId: this.recordId }]);
        if (this.messageContext) {
          publish(this.messageContext, CASE_SWARM_REFRESH, {
            recordId: this.recordId,
            action: "swarmStarted",
            swarmType: startedType
          });
        }
      })
      .catch((error) => {
        this.showError("Could not start swarm", error);
      })
      .finally(() => {
        this.isSubmitting = false;
      });
  }

  addMembersToActiveSwarm() {
    this.isSubmitting = true;
    addMembersToSwarm({
      caseId: this.recordId,
      memberUserIds: this.selectedMemberIds
    })
      .then(() => {
        this.dispatchEvent(
          new ShowToastEvent({
            title: "Members added",
            message: "Selected experts have been added to the Team.",
            variant: "success"
          })
        );
        this.selectedMembers = [];
        this.loadSwarmMembers();
        this.notifySwarmUi("swarmUpdated");
      })
      .catch((error) => {
        this.showError("Could not add members", error);
      })
      .finally(() => {
        this.isSubmitting = false;
      });
  }

  loadSwarmMembers() {
    this.membersLoaded = true;
    this.isLoadingMembers = true;
    getSwarmMembers({ caseId: this.recordId })
      .then((members) => {
        this.currentMembers = members || [];
      })
      .catch((error) => {
        this.currentMembers = [];
        this.showError("Could not load current swarm members", error);
      })
      .finally(() => {
        this.isLoadingMembers = false;
      });
  }

  async handleRemoveSwarmMember(event) {
    const removalId = event.currentTarget.dataset.id;
    const member = this.currentMembers.find((m) => m.removalId === removalId);
    const confirmed = await LightningConfirm.open({
      label: "Remove from swarm?",
      message: `Remove ${member?.displayName || "this person"} from this swarm in Microsoft Teams? They'll lose access immediately.`,
      variant: "destructive",
      theme: "warning"
    });
    if (!confirmed) {
      return;
    }

    removeMemberFromSwarm({ caseId: this.recordId, removalId })
      .then(() => {
        // Update from the removal we know just succeeded rather than re-fetching from
        // Graph immediately - membership changes aren't guaranteed to be read-your-writes
        // consistent there (same class of delay as the Teams chat soft-delete).
        this.currentMembers = this.currentMembers.filter(
          (m) => m.removalId !== removalId
        );
        this.dispatchEvent(
          new ShowToastEvent({
            title: "Member removed",
            message: "They no longer have access to this swarm in Teams.",
            variant: "success"
          })
        );
        this.notifySwarmUi("swarmUpdated");
      })
      .catch((error) => {
        this.showError("Could not remove member", error);
      });
  }

  handleOpenTeams() {
    window.open(this.teamUrl, "_blank", "noopener,noreferrer");
  }

  /**
   * caseSwarmChatCore (a sibling LWC, not a child of this one) holds the real usage counters -
   * ask it over the message channel rather than importing swarmUsageTracker directly here,
   * since Lightning Web Security doesn't guarantee separate component trees share plain JS
   * module state (confirmed live: that approach came back with every count empty). Resolves
   * with null if nothing responds within the timeout - e.g. the chat widget was never opened
   * this session, or isn't currently mounted on the page.
   */
  requestUsageSummary() {
    return new Promise((resolve) => {
      if (!this.messageContext) {
        resolve(null);
        return;
      }
      let settled = false;
      const finish = (usage) => {
        if (settled) {
          return;
        }
        settled = true;
        if (this.usageResponseSubscription) {
          unsubscribe(this.usageResponseSubscription);
          this.usageResponseSubscription = null;
        }
        resolve(usage);
      };

      this.usageResponseSubscription = subscribe(
        this.messageContext,
        CASE_SWARM_REFRESH,
        (message) => {
          if (
            message?.action === "usageSummaryResponse" &&
            message.recordId === this.recordId
          ) {
            finish(message.usage || null);
          }
        },
        { scope: APPLICATION_SCOPE }
      );
      publish(this.messageContext, CASE_SWARM_REFRESH, {
        recordId: this.recordId,
        action: "requestUsageSummary"
      });
      // eslint-disable-next-line @lwc/lwc/no-async-operation
      setTimeout(() => finish(null), USAGE_SUMMARY_TIMEOUT_MS);
    });
  }

  async handleResetSwarm() {
    const confirmed = await LightningConfirm.open({
      label: "Clear swarm data?",
      message:
        "This clears the swarm fields and chat transcript on this Case in Salesforce only. " +
        "It does NOT delete the Team or chat in Microsoft Teams - that keeps existing there untouched. " +
        "Use this to let a fresh swarm be started from Salesforce. This cannot be undone.",
      variant: "destructive",
      theme: "warning"
    });
    if (!confirmed) {
      return;
    }

    this.isResetting = true;
    try {
      const usage = await this.requestUsageSummary();
      await resetSwarm({ caseId: this.recordId, usage });
      this.dispatchEvent(
        new ShowToastEvent({
          title: "Swarm data cleared",
          message: "This case is ready for a new swarm.",
          variant: "success"
        })
      );
      this.selectedMembers = [];
      this.searchResults = [];
      this.currentMembers = [];
      this.membersLoaded = false;
      this.stopPolling();
      await refreshApex(this.wiredCaseRecord);
      await notifyRecordUpdateAvailable([{ recordId: this.recordId }]);
      if (this.messageContext) {
        publish(this.messageContext, CASE_SWARM_REFRESH, {
          recordId: this.recordId,
          action: "swarmReset"
        });
      }
    } catch (error) {
      this.showError("Could not clear swarm data", error);
    } finally {
      this.isResetting = false;
    }
  }

  /**
   * Same End Chat action as caseSwarmChat/caseSwarmChatCore's toolbar button (archive the Teams
   * conversation to Swarm_Message__c, clear swarm fields, best-effort delete the Teams chat) -
   * added here too so agents who only have the Case Swarm component on their page layout (not the
   * chat widget/utility item) still have a way to end and archive a Chat swarm, not just abandon
   * it via "Clear swarm data" with nothing saved.
   *
   * No local message history to merge in from here (this component never renders the chat), so
   * `messages: []` is passed - TeamsSwarmChatController.endChat always pulls Graph history itself
   * first regardless; the messages param is only ever a client-side merge/fallback on top of that.
   */
  async handleEndChat() {
    const confirmed = await LightningConfirm.open({
      label: "End Chat",
      message:
        "This saves the Teams conversation as Swarm Message records on the Case, clears swarm fields so the Case is ready for a new swarm, and deletes the chat in Microsoft Teams for everyone in it.",
      theme: "warning"
    });
    if (!confirmed) {
      return;
    }

    this.isEndingChat = true;
    try {
      const result = await endChat({ caseId: this.recordId, messages: [] });
      const savedCount = result?.savedCount || 0;
      const chatDeleteSuffix = result?.chatDeleteRequested
        ? " The Teams chat is being deleted."
        : "";
      this.dispatchEvent(
        new ShowToastEvent({
          title: "Chat ended",
          message:
            savedCount === 0
              ? `Swarm fields cleared. No messages were available to save.${chatDeleteSuffix}`
              : `Saved ${savedCount} message(s) to the Case transcript and cleared swarm fields.${chatDeleteSuffix}`,
          variant: savedCount === 0 ? "warning" : "success"
        })
      );
      this.selectedMembers = [];
      this.searchResults = [];
      this.currentMembers = [];
      this.membersLoaded = false;
      this.stopPolling();
      await refreshApex(this.wiredCaseRecord);
      await notifyRecordUpdateAvailable([{ recordId: this.recordId }]);
      if (this.messageContext) {
        // Same "swarmReset" action Reset Swarm already publishes - any mounted chat
        // widget/utility item reacts to it the same way (clears its own state) regardless
        // of which component actually triggered the end/clear.
        publish(this.messageContext, CASE_SWARM_REFRESH, {
          recordId: this.recordId,
          action: "swarmReset"
        });
      }
    } catch (error) {
      this.showError("Could not end chat", error);
    } finally {
      this.isEndingChat = false;
    }
  }

  showError(title, error) {
    const message = error?.body?.message || error?.message || "Unknown error";
    this.dispatchEvent(
      new ShowToastEvent({
        title,
        message,
        variant: "error"
      })
    );
  }
}
