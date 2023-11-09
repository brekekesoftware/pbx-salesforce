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
       fireLogFailedEvent,
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
      const calls = new Map<string, Call>();
      const callsResult = new Map<string, boolean>();

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

          const { objectType, recordId, recordName } = payload;

          if (objectType && recordId && recordName) {
            calls.forEach(call => {
              const id = callId(call);
              // cancel if phone search had positive results.
              if (callsResult.get(id)) return;

              const interval = setInterval(() => {
                // cancel interval if phone search has been completed
                if (callsResult.has(id)) clearInterval(interval);

                // cancel if phone search had positive results.
                if (callsResult.get(id)) return;

                // add contact if phone search had negative results.
                fireCallInfoEvent(call, {
                  id: recordId,
                  name: formatRecordName(recordName, objectType),
                  type: objectType,
                });
              }, 1000);
            });
          }
        },
      });

      onLoggedInEvent(() => {
        sforce.opencti.enableClickToDial({ callback: () => logger('enableClickToDial') });
      });

      onLoggedOutEvent(() => {
        callsResult.clear();
        calls.clear();
        sforce.opencti.disableClickToDial({ callback: () => logger('disableClickToDial') });
      });

      onCallEvent(call => void 0);
      onCallEndedEvent(call => calls.delete(callId(call)));

      onCallUpdatedEvent(call => {
        logger('onCallEvent', call);

        const id = callId(call);
        if (calls.has(id)) return;
        calls.set(id, call);

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

            const { success, returnValue } = response;

            const hasData = success && Object.keys(returnValue!).length > 0;

            callsResult.set(id, hasData);

            if (hasData) {
              fireCallInfoEvent(call, Object.values(returnValue!).map(mapContactResult));
            }
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

      onLogEvent(log => {
        logger('logEvent', log);

        if (!log.contactId) {
          fireNotification({ type: 'error', message: 'This call was not associated with a contact.' });
          return;
        }

        const call = log.call;
        const { subject, description, result } = log.inputs;

        const value = {
          Subject: subject,
          Description: description,
          CallDisposition: result,
          Status: 'completed',
          CallType: call.incoming ? 'Inbound' : 'Outbound',
          // ActivityDate: formatDate(new Date(call.createdAt)),
          CallObject: log.recording?.id,
          Phone: call.partyNumber,
          CallDurationInSeconds: call.getDuration() / 1000,
          WhoId: log.contactId,
          WhatId: log.related?.id,
          entityApiName: 'Task',
        };

        if (['Account', 'account'].includes(log.contactType!)) {
          // @ts-ignore
          delete value['WhoId'];
          value['WhatId'] = log.contactId;
        }

        sforce.opencti.saveLog({
          value,
          callback: (response) => {
            logger('saveLog response', response);
            if (response.success) {
              fireLogSavedEvent(log);
              sforce.opencti.refreshView();
            } else {
              fireLogFailedEvent(log);
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

const mapContactResult = (contact: SearchResult): Contact => ({
  id: contact.Id,
  name: formatRecordName(contact.Name, contact.RecordType),
  type: contact.RecordType,
});

const callId = (call: Call) => `${call.pbxRoomId}-${call.id}`;

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
