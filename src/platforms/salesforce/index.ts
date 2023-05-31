import {
  onCallEvent,
  onLogEvent,
  onLoggedInEvent,
  onLoggedOutEvent,
} from '@/utils/events/listeners';
import { fireCallInfoEvent, fireLogSavedEvent, fireMakeCallEvent } from '@/utils/events/triggers';

const setupOpenCti = () => {
  return new Promise<void>((resolve) => {
    const salesForceHost = document.location.ancestorOrigins[0];
    const scriptSrc = `${salesForceHost}/support/api/57.0/lightning/opencti_min.js`;

    // load salesforce opencti script
    const script = document.createElement('script');
    script.src = scriptSrc;
    script.onload = () => {
      console.log('opencti ready');
      resolve();
    };

    document.head.appendChild(script);
  });
};

setupOpenCti().then(() => {
  // add click-to-call listener
  sforce.opencti.onClickToDial({
    listener: (payload) => {
      console.log('clickToDial', payload);
      fireMakeCallEvent(String(payload.number));
    },
  });

  sforce.opencti.onNavigationChange({
    listener: (payload) => {
      console.log('onNavigationChange', payload);
    },
  });

  onLoggedInEvent(() => {
    sforce.opencti.enableClickToDial({ callback: () => console.log('enableClickToDial') });
  });

  onLoggedOutEvent(() => {
    sforce.opencti.disableClickToDial({ callback: () => console.log('disableClickToDial') });
  });

  onCallEvent(({ call }) => {
    console.log('xxx onCallEvent', call);
    sforce.opencti.searchAndScreenPop({
      searchParams: call.partyNumber,
      deferred: false,
      callType: call.incoming ? sforce.opencti.CALL_TYPE.INBOUND : sforce.opencti.CALL_TYPE.OUTBOUND,
      // callType: sforce.opencti.CALL_TYPE.INTERNAL,
      defaultFieldValues: {
        Phone: call.partyNumber,
        // MobilePhone: call.partyNumber,
        // FirstName: call.getDisplayName(),
      },
      callback: response => {
        console.log('searchAndScreenPop', response);
        if (response.success && Object.keys(response.returnValue!).length === 1) {
          const recordId = Object.keys(response.returnValue!)[0];

          const record = response.returnValue![recordId];

          fireCallInfoEvent(call, {
            id: record.Id,
            name: `[${record.RecordType}] ${record.Name}`,
          });

          // sforce.opencti.screenPop({
          //   type: sforce.opencti.SCREENPOP_TYPE.SOBJECT,
          //   params: {
          //     recordId,
          //     recordName: response.returnValue![recordId],
          //     objectType: 'Contact',
          //   },
          // });
        }
      },
    });
  });

  onLogEvent(({ log }) => {
    console.log('logEvent', log);
    const call = log.call;
    sforce.opencti.saveLog({
      value: {
        Subject: log.subject,
        Status: 'completed',
        CallType: call.incoming ? 'Inbound' : 'Outbound',
        // ActivityDate: formatDate(new Date(call.createdAt)),
        CallObject: `${log.tenant} ${call.id}.${call.createdAt} ${log.user}`,
        Phone: call.partyNumber,
        Description: log.comment,
        CallDisposition: log.result,
        CallDurationInSeconds: call.getDuration() / 1000,
        WhoId: log.recordId,
        WhatId: log.relatedRecordId,
        entityApiName: 'Task',
      },
      callback: (response) => {
        console.log('saveLog response', response);
        if (response.success) {
          fireLogSavedEvent(log);
          sforce.opencti.refreshView();
        }
      },
    });
  });
});

const formatDate = (date: Date) => {
  return `${date.getFullYear()}-${date.getMonth() + 1}-${date.getDate()}`;
};
