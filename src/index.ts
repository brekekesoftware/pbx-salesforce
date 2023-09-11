import { SearchResult } from '@/opencti';
import { Call } from '@core/types/phone';
import { Contact } from '@core/types/events';

const setupOpenCti = () => {
  return new Promise<void>((resolve) => {
    const salesForceHost = document.referrer;
    const scriptSrc = `${salesForceHost}/support/api/57.0/lightning/opencti_min.js`;

    // load salesforce opencti script
    const script = document.createElement('script');
    script.src = scriptSrc;
    script.onload = () => {
      logger('opencti ready');
      resolve();
    };

    document.head.appendChild(script);
  });
};

setupOpenCti().then(() => {
  window.Brekeke.renderWidget(
    document.getElementById('widget_embed_div')!,
    ({
       fireCallInfoEvent,
       fireLogSavedEvent,
       fireMakeCallEvent,
       onCallRecordedEvent,
       onCallUpdatedEvent,
       onCallEndedEvent,
       onLoggedOutEvent,
       onLoggedInEvent,
       onCallEvent,
       onLogEvent,
       onContactSelectedEvent,
     }) => {
      let currentCall: Call | undefined;
      const calls: string[] = [];
      const callRecordingURLs = new Map<string, string>();

      // add click-to-call listener
      sforce.opencti.onClickToDial({
        listener: (payload) => {
          logger('clickToDial', payload);
          fireMakeCallEvent(String(payload.number));
        },
      });

      sforce.opencti.onNavigationChange({
        listener: (payload) => {
          logger('onNavigationChange', payload);

          if (currentCall && payload.objectType) {
            fireCallInfoEvent(currentCall, {
              id: payload.recordId,
              name: formatRecordName(payload.recordName, payload.objectType),
            });
          }
        },
      });

      onLoggedInEvent(() => {
        sforce.opencti.enableClickToDial({ callback: () => logger('enableClickToDial') });
      });

      onLoggedOutEvent(() => {
        currentCall = undefined;
        callRecordingURLs.clear();
        calls.length = 0;
        sforce.opencti.disableClickToDial({ callback: () => logger('disableClickToDial') });
      });

      onCallEvent(call => void (currentCall = call));
      onCallEndedEvent(call => {
        if (call.pbxRoomId === currentCall?.pbxRoomId) {
          currentCall = undefined;
        }
      });

      onCallUpdatedEvent(call => {
        logger('onCallEvent', call);

        if (calls.includes(call.pbxRoomId)) return;
        calls.push(call.pbxRoomId);

        sforce.opencti.setSoftphonePanelVisibility({ visible: true });
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
            logger('searchAndScreenPop', response);

            const mapContactResult = (contact: SearchResult): Contact => ({
              id: contact.Id,
              name: contact.Name,
              type: contact.RecordType,
            });

            if (response.success) {
              fireCallInfoEvent(call, Object.values(response.returnValue!).map(mapContactResult));
            }

            // if (response.success && Object.keys(response.returnValue!).length === 1) {
            //   const recordId = Object.keys(response.returnValue!)[0];
            //
            //   const record = response.returnValue![recordId];
            //
            //   fireCallInfoEvent(call, {
            //     id: record.Id,
            //     name: formatRecordName(record.Name, record.RecordType),
            //   });
            //
            //   // sforce.opencti.screenPop({
            //   //   type: sforce.opencti.SCREENPOP_TYPE.SOBJECT,
            //   //   params: {
            //   //     recordId,
            //   //     recordName: response.returnValue![recordId],
            //   //     objectType: 'Contact',
            //   //   },
            //   // });
            // }
          },
        });
      });

      onContactSelectedEvent(({ contact }) => {
          sforce.opencti.screenPop({
            type: sforce.opencti.SCREENPOP_TYPE.SOBJECT,
            params: {
              recordId: contact.id,
              // recordName: response.returnValue![recordId],
              // objectType: 'Contact',
            },
          });
      });

      onCallRecordedEvent(record => {
        logger('onCallRecordedEvent', record);
        callRecordingURLs.set(record.roomId, record.recordingId);
      });

      // TODO Account seems to have issue
      onLogEvent(log => {
        logger('logEvent', log);
        const call = log.call;
        sforce.opencti.saveLog({
          value: {
            Subject: log.subject,
            Status: 'completed',
            CallType: call.incoming ? 'Inbound' : 'Outbound',
            // ActivityDate: formatDate(new Date(call.createdAt)),
            CallObject: callRecordingURLs.get(call.pbxRoomId),
            Phone: call.partyNumber,
            Description: log.comment,
            CallDisposition: log.result,
            CallDurationInSeconds: call.getDuration() / 1000,
            WhoId: log.recordId,
            WhatId: log.relatedRecordId,
            entityApiName: 'Task',
          },
          callback: (response) => {
            logger('saveLog response', response);
            if (response.success) {
              fireLogSavedEvent(log);
              callRecordingURLs.delete(call.pbxRoomId);
              sforce.opencti.refreshView();
            }
          },
        });
      });
    },
  );
});

const formatRecordName = (name: string, type: string) => `[${type}] ${name}`;

const formatDate = (date: Date) => {
  return `${date.getFullYear()}-${date.getMonth() + 1}-${date.getDate()}`;
};

const logName = 'brekeke-widget:salesforce';
const logger = (...args: unknown[]) => {
  if (!location.host.startsWith('localhost') && !location.host.startsWith('127.0.0.1')) return;
  if (typeof args[0] === 'string' && args[0].includes('error')) {
    console.error(logName, ...args);
    return;
  }
  console.log(logName, ...args);
};
