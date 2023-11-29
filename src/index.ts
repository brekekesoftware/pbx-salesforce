import { SearchResult } from '@/opencti';
import { Contact } from '@core/types/events';
import { Call } from '@core/types/phone';

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

      let currentURL = document.referrer;

      let queue: { call: Call, SCREEN_POP_DATA: never, opened: boolean, current: boolean }[] = [];

      const removeCallFromQueue = (call: Call) => {
        queue = queue.filter(value => callId(call) !== callId(value.call));
      };

      // open new contact modal for oldest unopened entry, then push it to the back of the queue
      const runQueue = () => {
        if (queue.length === 0) return;
        const data = queue.find(({ opened }) => !opened);

        logger('runQueue', { currentURL, data });

        if (!data) return;
        removeCallFromQueue(data.call);

        sforce.opencti.screenPop(data.SCREEN_POP_DATA);
        queue = queue.map(value => ({ ...value, current: false }));
        queue.push({ ...data, opened: true, current: true });
      };

      // const removeCurrentQueuedCall = () => {
      //   const data = queue.find(({ current }) => current);
      //
      //   if (data) {
      //     removeCallFromQueue(data.call);
      //   }
      //
      //   return data;
      // };

      const search = (call: Call, callback: (call: Call, SCREEN_POP_DATA: any, hasData: boolean) => void, isNew: boolean = false) => {
        logger('search', { call, isNew });

        sforce.opencti.setSoftphonePanelVisibility({ visible: !isNew });

        sforce.opencti.searchAndScreenPop({
          searchParams: call.partyNumber,
          deferred: true,
          callType: call.incoming ? sforce.opencti.CALL_TYPE.INBOUND : sforce.opencti.CALL_TYPE.OUTBOUND,
          // callType: sforce.opencti.CALL_TYPE.INTERNAL,
          defaultFieldValues: {
            Phone: call.partyNumber,
            // MobilePhone: call.partyNumber,
            // FirstName: call.getDisplayName(),
          },
          callback: response => {
            logger('searchAndScreenPop', { response, isNew });

            const { success, returnValue } = response;
            // @ts-ignore
            const { SCREEN_POP_DATA, ...data } = returnValue;

            const hasData = success && Object.keys(data).length > 0;

            if (hasData) {
              fireCallInfoEvent(call, Object.values(data).map(mapContactResult));
            }

            callback(call, SCREEN_POP_DATA, hasData);
          },
        });
      };

      sforce.opencti.onNavigationChange({
        listener: (payload) => {
          logger('onNavigationChange', payload);
          const { url } = payload;

          if (currentURL === url) {
            logger('onNavigationChange exit: same URL', { currentURL, url });
            return;
          }

          const prevURL = currentURL;
          currentURL = url;

          if (queue.length === 0 || isNewContactModal(url)) {
            logger('onNavigationChange exit: empty queue or modal', { queue, url });
            return;
          }

          const prevURLWasNewContact = isNewContactModal(prevURL);
          if (!prevURLWasNewContact) {
            logger('onNavigationChange exit: prevURL was not modal', { prevURL });
            return;
          }

          // if current page [url] was the background page of a dismissed new-contact modal page [prevURL].
          // const cancelled = isPath(url, newContactBackgroundPagePath(prevURL));
          // const saved = !isPath(url, newContactBackgroundPagePath(prevURL));
          //
          // const { objectType, recordId, recordName } = payload;

          // if (cancelled) {
          //   removeCurrentQueuedCall();
          // }
          //
          // if (saved) {
          //   const data = removeCurrentQueuedCall();
          //
          //   if (!data) return;
          //
          //   fireCallInfoEvent(data.call, {
          //     id: recordId,
          //     name: formatRecordName(recordName, objectType),
          //     type: objectType,
          //   });
          // }

          queue.forEach(({ call, opened }) => {
            if (!opened) return;

            search(call, (call, SCREEN_POP_DATA, hasData) => {
              logger('queue search', { hasData, SCREEN_POP_DATA, call });
              if (!hasData) return;
              removeCallFromQueue(call);
            }, true);
          });

          runQueue();
        },
      });

      onLoggedInEvent(() => {
        sforce.opencti.enableClickToDial({ callback: () => logger('enableClickToDial') });
      });

      onLoggedOutEvent(() => {
        calls.clear();
        queue.length = 0;
        sforce.opencti.disableClickToDial({ callback: () => logger('disableClickToDial') });
      });

      onCallEvent(call => void 0);
      onCallEndedEvent(call => calls.delete(callId(call)));

      onCallUpdatedEvent(call => {
        logger('onCallEvent', call);

        const id = callId(call);
        if (calls.has(id)) {
          logger('onCallUpdatedEvent exit: id exists', { call, id });
          return;
        }
        calls.set(id, call);

        search(call, (call, SCREEN_POP_DATA, hasData) => {
          logger('onCallUpdatedEvent search callback', { call, SCREEN_POP_DATA, hasData });
          const isNewContact = !hasData;

          let canPopNew = false;

          // put new contacts in queue so that they can be processed on navigation changes.
          if (isNewContact) {
            canPopNew = queue.length === 0 && !isNewContactModal(currentURL);
            // @ts-ignore
            queue.push({ call, SCREEN_POP_DATA, opened: canPopNew, current: canPopNew });
          }

          logger('onCallUpdatedEvent', { isNewContact, canPopNew, queue, call });

          // don't screen pop if a new contact modal is currently opened or queued.
          if (isNewContact && !canPopNew) return;

          sforce.opencti.screenPop(SCREEN_POP_DATA);
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
          fireNotification({
            type: 'error',
            message: 'This call was not associated with a contact.',
          });
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

const isPath = (url: string, path?: string | null) => new URL(url).pathname === path;
const isNewContactModal = (url: string) => isPath(url, '/lightning/o/Contact/new');
const newContactBackgroundPagePath = (url: string) => new URL(url).searchParams.get('backgroundContext');

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
