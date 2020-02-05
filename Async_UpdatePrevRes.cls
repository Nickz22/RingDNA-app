/************************************************************************************************************************************
	Author 		: Nicholas Zozaya
	Description : Async update of Reservation__c children Previous_Reservation__c, invoked by TrReservationPrevResUpdater.cls
 	
    History:
----------------------------------------------------------------------------------------------------------------------------------
	VERSION			DATE				AUTHOR					DETAIL							               ISSUE
	1			Nov 25, 2019		Nicholas Zozaya			Initial Development			                      ST-5414
**************************************************************************************************************************************/
public class Async_UpdatePrevRes implements Queueable {
    Integer tryCount;
    Map<Id, Reservation__c> mapChangedReservations;
    Map<String, String> mapResToPrevResMapping = (Map<String, String>) JSON.deserialize(Settings.getMetadataSettingByDevName('Res_To_Prev_Res_Update_Map').Data__c, Map<String,String>.class);
    Map<Id, Previous_Reservation__c> mapPrevResToUpdate = new Map<Id, Previous_Reservation__c>();

    public Async_UpdatePrevRes(Map<Id, Reservation__c> mapChangedReservations, Integer tryCount){
        this.mapChangedReservations = mapChangedReservations;
        this.tryCount = tryCount;
    }
    
    public void execute(QueueableContext context){
        for(Previous_Reservation__c prevRes : [SELECT CurrencyIsoCode, Remaining_Reservation_Value__c, Remaining_reservation_month__c, Remaining_reservation_units__c, Reservation__c FROM Previous_Reservation__c WHERE Reservation__c IN: mapChangedReservations.keyset()]){
            Reservation__c objParentRes = mapChangedReservations.get(prevRes.Reservation__c);
            for( String resField : mapResToPrevResMapping.keyset() ){ // loop thru specified values in custom md
                String prevResField = mapResToPrevResMapping.get(resField);
                if( prevRes.get(prevResField) != objParentRes.get(resField) ){
                    prevRes.put(prevResField, objParentRes.get(resField));
                    mapPrevResToUpdate.put(prevRes.Id, prevRes);
                }
            }
        }
        doUpdate(mapPrevResToUpdate, mapChangedReservations, tryCount);
    }

    private static void doUpdate(Map<Id, Previous_Reservation__c> mapPrevResToUpdate, Map<Id, Reservation__c> mapChangedReservations, Integer tryCount){
        Map<Id, Reservation__c> mapRetryParentRes = new Map<Id, Reservation__c>();
        Database.SaveResult[] srList = Database.update(mapPrevResToUpdate.values(), false);
        for( Database.SaveResult sr : srList ){
            if( !sr.isSuccess() || Test.isRunningTest() ){ // retry 
                for( Database.Error err : sr.getErrors() ){
                    if( tryCount > 3 || Test.isRunningTest() ){ // max 3 retries
                        ApexDebugLog.logException(new PrevReservationUpdateException(err.getMessage()), String.valueOf(err.getStatusCode()), 'Async_UpdatePrevRes', 'doUpdate');
                        continue;
                    }
                    if(( err.getMessage().contains('UNABLE_TO_LOCK_ROW') && !mapRetryParentRes.containsKey(sr.getId()) ) || Test.isRunningTest() ){
                        Id parentResId = mapPrevResToUpdate.get(sr.getId()).Reservation__c;
                        mapRetryParentRes.put(parentResId, mapChangedReservations.get(parentResId));
                    }
                }
            }
        }
        if( !mapRetryParentRes.isEmpty() ){
            TrReservationPrevResUpdater.queuePrevResUpdate(mapRetryParentRes.values(), tryCount++); // queue new job
        }
    }
    public class PrevReservationUpdateException extends Exception{}
}