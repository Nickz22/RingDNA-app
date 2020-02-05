import { LightningElement,api,track } from 'lwc';
import trackingComponentId from '@salesforce/label/c.Add_Account_Team_Tracker';
import roleOptions from '@salesforce/label/c.Valid_AccountTeamMember_Roles';
import {getErrorMessage,getMapFromArray} from 'c/lwcUtil';
import getRegionalTerritoryNames from '@salesforce/apex/LightningComponentController.getRegionalTerritoryNames';
import { NavigationMixin } from 'lightning/navigation';
import { createRecord } from 'lightning/uiRecordApi';
import MEMBER_USERID_FIELD from '@salesforce/schema/AccountTeamMember.UserId';
import MEMBER_ACCOUNTID_FIELD from '@salesforce/schema/AccountTeamMember.AccountId';
import MEMBER_TEAM_MEMBER_ROLE_FIELD from '@salesforce/schema/AccountTeamMember.TeamMemberRole';
import MEMBER_REGION_FIELD from '@salesforce/schema/AccountTeamMember.Region__c';
import MEMBER_TERRITORY_FIELD from '@salesforce/schema/AccountTeamMember.Territory__c';
import MEMBER_ACCOUNT_ACCESS_FIELD from '@salesforce/schema/AccountTeamMember.AccountAccessLevel';
import MEMBER_CONTACT_ACCESS_FIELD from '@salesforce/schema/AccountTeamMember.ContactAccessLevel';
import MEMBER_CASE_ACCESS_FIELD from '@salesforce/schema/AccountTeamMember.CaseAccessLevel';
import MEMBER_OPPORTUNITY_ACCESS_FIELD from '@salesforce/schema/AccountTeamMember.OpportunityAccessLevel';
import ACCOUNT_TEAM_MEMBER from '@salesforce/schema/AccountTeamMember';
const atmFields = [
    MEMBER_USERID_FIELD,
    MEMBER_ACCOUNTID_FIELD,
    MEMBER_TEAM_MEMBER_ROLE_FIELD,
    MEMBER_REGION_FIELD,
    MEMBER_TERRITORY_FIELD,
    MEMBER_ACCOUNT_ACCESS_FIELD,
    MEMBER_CONTACT_ACCESS_FIELD,
    MEMBER_CASE_ACCESS_FIELD,
    MEMBER_OPPORTUNITY_ACCESS_FIELD
];

export default class AddAccountTeam extends NavigationMixin(LightningElement) {
    @api accountId;
    @track rows = [new AccountTeamMemberWrapper(1), new AccountTeamMemberWrapper(2), new AccountTeamMemberWrapper(3)];
    @track processing = false;
    @track roleOptions = roleOptions.split(",");
    @track successfulSave = false;
    @track error;
    userIdMemberMap = new Map();
    hasSaveError = false;
    regionToTerritoryMap = new Map();
    regionNames = [];

    connectedCallback(){
        getRegionalTerritoryNames().then(
            mapRegionToTerritories => {
                for( let regionId in mapRegionToTerritories ){  
                    for( let regionName in mapRegionToTerritories[regionId] ){
                        this.regionNames.push(regionName);
                        this.regionToTerritoryMap.set(regionId, mapRegionToTerritories[regionId][regionName]);
                    }
                }
            }
        ).catch( // 
            error => { // allow quiet failure as this error shouldnt stop user from proceeding
            this.error = error;
            console.error("error getting regional territories ==> "+getErrorMessage(error));
        })
    }

    addRow = () => {
        this.rows.push(new AccountTeamMemberWrapper(this.rows.length > 0 ? (this.rows[this.rows.length -1].OrderNumber+1) : 1));
    }

    removeRow = event => {
        if(!event.currentTarget.iconName.includes('approval')){
            for(let i = 0; i < this.rows.length; i++){
                if(this.rows[i].OrderNumber == event.currentTarget.dataset.id){
                    this.rows.splice(i, 1);
                }
            }
        }
    }

    removeRedBorder = event => {
        event.currentTarget.parentElement.classList.remove("red-border");
    }

    conditionalFieldDisable = event => {
        let disableRegion = (event.currentTarget.value.toLowerCase() == "bdm" || event.currentTarget.value.toLowerCase() == "nmd" || event.currentTarget.value.toLowerCase() == "mlb hold");
        let disableTerritory = disableRegion ? true : event.currentTarget.value.toLowerCase().includes("region");
        let disableFields = this.template.querySelectorAll("lightning-input-field[data-id='"+event.currentTarget.dataset.id+"']");
        for(let i = 0; i<disableFields.length; i++){
            if( disableFields[i].fieldName == "Region__c" || disableFields[i].fieldName == "Territory__c" ){
                disableFields[i].disabled = disableFields[i].fieldName == "Region__c" ? disableRegion : disableTerritory;
            }
        }
        this.showAssistiveText(event);
    }

    showAssistiveText = event => {
        let assistiveText = this.template.querySelector("p[data-id='"+event.currentTarget.dataset.id+"']");    
        if( event.currentTarget.classList.contains('slds-select') && !assistiveText.innerText){
            assistiveText.innerText = 'Regions: '+this.regionNames.join(', ');
        }else{
            if(this.regionToTerritoryMap.get(event.currentTarget.value)){
                assistiveText.innerText = "Territories: "+this.regionToTerritoryMap.get(event.currentTarget.value).join(", ");
            }
        }
        assistiveText.classList.add('regional-territories');
    }

    clearTerritoryNames = event => {
        let territoryText = this.template.querySelector("p[data-id='"+event.currentTarget.dataset.id+"']");
        territoryText.classList.remove('regional-territories');
        territoryText.innerText = "";
    }

    insertNewMembers = () => {
        try{
            let inputRows = this.template.querySelectorAll("lightning-input-field, select");
            let finishedMembers = [];
            let newMemberMap = getMapFromArray("OrderNumber", this.rows, true);
            for(let i = 0; i<inputRows.length; i++){
                // dont allow blank UserId field
                if(inputRows[i].fieldName == "UserId" && ((inputRows[i].value && inputRows[i].value.length < 1) || !inputRows[i].value)){
                    inputRows[i].parentElement.classList.add("red-border");
                    return;
                }
                if(inputRows[i].value != null && inputRows[i].value != ''){
                    let member = newMemberMap.get(inputRows[i].dataset.id);
                    member[inputRows[i].fieldName ? inputRows[i].fieldName : "TeamMemberRole"] = inputRows[i].value; // <select> tag has no fieldName property
                    newMemberMap.set(inputRows[i].dataset.id, member);
                }
            }
            for (const [key, value] of newMemberMap.entries()){
                value["AccountId"] = this.accountId;
                finishedMembers.push(value);
                this.userIdMemberMap.set(value.UserId, value);
            }
            this.doLdsInsert(finishedMembers);   
        }catch(error){
            this.error = error;
            throw new Error(getErrorMessage(error));
        }
    }

    doLdsInsert = members => {
        this.processing = true;
        let recordInputs = [];
        for(let i = 0; i < members.length; i++){
            const fields = {"Start_Date__c": new Date()};
            for(let x = 0; x < atmFields.length; x++){
                fields[atmFields[x].fieldApiName] = members[i][atmFields[x].fieldApiName];
            }
            const recordInput = {apiName: ACCOUNT_TEAM_MEMBER.objectApiName, fields};
            recordInputs.push(recordInput);
        }
        this.asyncInsertMember(recordInputs);
    }

    asyncInsertMember = async recordInputs => {
        this.hasSaveError = false;
        for(let i = 0; i<recordInputs.length; i++){
            let memberIcon = this.template.querySelector("lightning-icon[data-id='"+this.userIdMemberMap.get(recordInputs[i].fields.UserId).OrderNumber+"']");
            let saveResultText = this.template.querySelectorAll("p[data-id='"+this.userIdMemberMap.get(recordInputs[i].fields.UserId).OrderNumber+"']")[1];
            try{
                let result = await createRecord(recordInputs[i]);
                memberIcon.iconName = "action:approval";
                saveResultText.innerText = "saved successfully";
                saveResultText.className = "slds-text-color_success";
            }catch(error){
                this.hasSaveError = true;
                memberIcon.iconName = "action:close";
                saveResultText.innerText = getErrorMessage(error);
                saveResultText.className = "slds-text-color_error";
            }
        }
        this.successfulSave = !this.hasSaveError;
        this.processing = false;
    }

    navToAccount = () => {
        history.back();
    }
}

class AccountTeamMemberWrapper {
    constructor(num){
        this.OrderNumber = num;
        this.UserId = '';
        this.TeamMemberRole = '';
        this.Region__c = '';
        this.Territory__c = '';
        this.AccountAccessLevel = '';
        this.CaseAccessLevel = '';
        this.ContactAccessLevel = '';
        this.OpportunityAccessLevel = '';
    }
}