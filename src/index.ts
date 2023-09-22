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
       fireConfigEvent,
       fireLogSavedEvent,
       fireMakeCallEvent,
       fireNotification,
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

      // add click-to-call listener
      sforce.opencti.onClickToDial({
        listener: (payload) => {
          logger('clickToDial', payload);
          fireMakeCallEvent(String(payload.number));
        },
      });

      fireConfigEvent({
        logInputs: [
          {
            label: 'Subject',
            name: 'subject',
            type: 'text',
            required: true,
            defaultValue: call => `Call on ${new Date(call.createdAt).toUTCString()}`,
          },
          {
            label: 'Description',
            name: 'description',
            type: 'textarea',
          },
          {
            label: 'Result',
            name: 'result',
            type: 'text',
          },
        ],
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

        const callId = `${call.pbxRoomId}-${call.id}`;
        if (calls.includes(callId)) return;
        calls.push(callId);

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
              name: formatRecordName(contact.Name, contact.RecordType),
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

      // TODO Account seems to have issue
      onLogEvent(log => {
        logger('logEvent', log);

        if (!log.contactId) {
          fireNotification({ type: 'error', message: 'This call was not associated with a contact.' });
          return;
        }

        const call = log.call;
        const { subject, description, result } = log.inputs;

        sforce.opencti.saveLog({
          value: {
            Subject: subject,
            Description: description,
            CallDisposition: result,
            Status: 'completed',
            CallType: call.incoming ? 'Inbound' : 'Outbound',
            // ActivityDate: formatDate(new Date(call.createdAt)),
            CallObject: log.recording?.url,
            Phone: call.partyNumber,
            CallDurationInSeconds: call.getDuration() / 1000,
            WhoId: log.contactId,
            WhatId: log.related?.id,
            entityApiName: 'Task',
          },
          callback: (response) => {
            logger('saveLog response', response);
            if (response.success) {
              fireLogSavedEvent(log);
              sforce.opencti.refreshView();
            } else {
              fireNotification({ message: 'An error occurred', type: 'error' });
              const error = response.errors?.[0];
              if (error) {
                const message = typeof error === 'string' ? error : error.description;
                logger('saveLog error', message);
              }
            }
          },
        });
      });
    },
  );
});

const formatRecordName = (name: string, type: string) => `${name} [${type}]`;

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
