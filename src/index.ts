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

      // add click-to-call listener
      sforce.opencti.onClickToDial({
        listener: (payload) => {
          logger('clickToDial', payload);
          fireMakeCallEvent(String(payload.number));
        },
      });

      fireConfigEvent({
        version: 'SF1',
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

      const queue = {
        items: [] as { call: Call, SCREEN_POP_DATA: any, opened: boolean, current: boolean }[],
        searchIntervals: new Map<string, NodeJS.Timer>,
        isEmpty: () => queue.items.length === 0,
        current: () => queue.items.find(({ current }) => current),
        removeItem: (call: Call) => {
          queue.items = queue.items.filter(item => callId(call) !== callId(item.call));
        },
        reset: () => {
          queue.items.length = 0;
          queue.searchIntervals.forEach(clearInterval);
          queue.searchIntervals.clear();
        },
        // open new contact modal for oldest unopened entry, then push it to the back of the queue
        run: () => {
          if (queue.items.length === 0) return;
          const data = queue.items.find(({ opened }) => !opened);

          logger('runQueue', { currentURL, data });

          if (!data) return;
          queue.removeItem(data.call);

          sforce.opencti.screenPop(data.SCREEN_POP_DATA);
          queue.items = queue.items.map(value => ({ ...value, current: false }));
          queue.items.push({ ...data, opened: true, current: true });
        },
      };

      const search = (call: Call, callback: (call: Call, SCREEN_POP_DATA: any, hasData: boolean) => void, isNew: boolean = false) => {
        logger('search', { call, isNew });

        if (!isNew) {
          sforce.opencti.setSoftphonePanelVisibility({ visible: true });
        }

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

          if (queue.isEmpty() || isNewContactModal(url)) {
            logger('onNavigationChange exit: empty queue or modal', { queue: queue.items, url });
            return;
          }

          if (!isNewContactModal(prevURL)) {
            logger('onNavigationChange exit: prevURL was not new contact modal', { prevURL });
            return;
          }

          const current = queue.current();
          if (!current) {
            logger('onNavigationChange exit: no current queue item', { prevURL });
            return;
          }

          // if current page [url] was the background page of a dismissed new-contact modal page [prevURL].
          const cancelled = isPath(url, newContactBackgroundPagePath(prevURL));
          const maybeSaved = !isPath(url, newContactBackgroundPagePath(prevURL));

          if (cancelled) {
            logger('onNavigationChange cancelled', { current, prevURL, currentURL, payload });
          }

          const { objectType, recordId, recordName } = payload;
          const hasRecord = !!objectType && !!recordId && !!recordName;
          const saved = hasRecord && maybeSaved;

          if (saved) {
            logger('onNavigationChange saved', { current, prevURL, currentURL, payload });
            fireCallInfoEvent(current.call, {
              id: recordId,
              name: formatRecordName(recordName, objectType),
              type: objectType,
            });
          }

          if (saved || cancelled) {
            queue.removeItem(current.call);
          }

          logger('onNavigationChange status', { saved, cancelled });

          queue.items.forEach(({ call, opened }) => {
            if (!opened) return;

            const id = callId(call);
            const prioritize = saved && callId(current.call) === id;
            const max = prioritize ? 20 : 10;
            const timeout = prioritize ? 2500 : 5000;

            if (queue.searchIntervals.has(id)) {
              clearInterval(queue.searchIntervals.get(id));
            }

            let count = 0;
            const interval = setInterval(() => {
              ++count;
              search(call, (call, SCREEN_POP_DATA, hasData) => {
                logger('queue search', { hasData, SCREEN_POP_DATA, call, count });

                if (!hasData && count < max) {
                  logger(`queue search exit: no data && attempt < ${max}`, {
                    hasData,
                    maybeSaved: prioritize,
                    SCREEN_POP_DATA,
                    call,
                    count,
                  });
                  return;
                }

                queue.searchIntervals.delete(id);
                clearInterval(interval);
                queue.removeItem(call);
              }, true);
            }, timeout);

            queue.searchIntervals.set(id, interval);
          });

          setTimeout(queue.run, 2500);
        },
      });

      onLoggedInEvent(() => {
        sforce.opencti.enableClickToDial({ callback: () => logger('enableClickToDial') });
      });

      onLoggedOutEvent(() => {
        calls.clear();
        queue.reset();
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
            canPopNew = queue.items.filter(({ opened }) => !opened).length === 0 && !isNewContactModal(currentURL);
            queue.items.push({ call, SCREEN_POP_DATA, opened: canPopNew, current: canPopNew });
          }

          logger('onCallUpdatedEvent', { isNewContact, canPopNew, queue: queue.items, call });

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

const isPath = (url: string, path: string | string[], withQuery = true) => {
  const object = new URL(url);
  let urlPath = object.pathname;

  if (withQuery) {
    urlPath += object.search;
  }

  const p = Array.isArray(path) ? path : [path];

  return p.some(value => value === urlPath);
};
let contactTypes = ['Account', 'Contact', 'Lead'];
contactTypes = contactTypes.map(type => `/lightning/o/${type}/new`);
const isNewContactModal = (url: string) => isPath(url, contactTypes, false);
const newContactBackgroundPagePath = (url: string) => new URL(url).searchParams.get('backgroundContext') ?? '';

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
const logHosts = ['localhost', '127.0.0.1', 'test2.brekeke.vn'];
const logger = (...args: unknown[]) => {
  if (!logHosts.includes(location.hostname)) return;
  if (typeof args[0] === 'string' && args[0].includes('error')) {
    console.error(logName, ...args);
    return;
  }
  console.log(logName, ...args);
};
