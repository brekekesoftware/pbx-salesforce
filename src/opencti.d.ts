type Callback<T> = (response: T) => void;
type Listener<T> = (payload: T) => void;

interface CallbackResponse<T> {
  success: boolean;
  returnValue?: T;
  errors?: string[];
}

type SearchResult = {
  Id: string;
  Name: string;
  RecordType: string;
}

interface CallbackResponses {
  toggleClickToDial: CallbackResponse<null>;
  setSoftphonePanelVisibility: CallbackResponse<null>;
  refreshView: CallbackResponse<null>;
  runApex: CallbackResponse<{ runApex: string }>;
  saveLog: CallbackResponse<string | null>;
  searchAndScreenPop: CallbackResponse<Record<string, SearchResult>>;
}

interface PayloadTypes {
  onClickToDial: {
    number: number;
    recordId: string;
    recordName: string;
    objectType: string;
    accountId?: string;
    contactId?: string;
    personAccount?: boolean;
    params?: string;
  };
  onNavigationChange: {
    url: string;
    recordId: string;
    recordName: string;
    objectType: string;
    accountId?: string;
    contactId?: string;
    personAccount?: boolean;
  };
}

interface OpenCTI {
  disableClickToDial: (params: {
    callback: Callback<CallbackResponses['toggleClickToDial']>
  }) => void;
  enableClickToDial: (params: {
    callback: Callback<CallbackResponses['toggleClickToDial']>
  }) => void;
  onClickToDial: (params: { listener: Listener<PayloadTypes['onClickToDial']> }) => void;
  setSoftphonePanelVisibility: (params: {
    visible: boolean;
    callback?: Callback<CallbackResponses['setSoftphonePanelVisibility']>
  }) => void;
  onNavigationChange: (params: { listener: Listener<PayloadTypes['onNavigationChange']> }) => void;
  runApex: (params: {
    apexClass: string;
    methodName: string;
    methodParams: string;
    callback: Callback<CallbackResponses['runApex']>
  }) => void;
  saveLog: (params: {
    value: Record<string, string | number | undefined>;
    callback: Callback<CallbackResponses['saveLog']>
  }) => void;
  refreshView: (params?: { callback?: Callback<CallbackResponses['refreshView']> }) => void;
  screenPop: (params: {
    type: keyof OpenCTI['SCREENPOP_TYPE'];
    params: {}; // TODO
  }) => void;
  SCREENPOP_TYPE: {
    SOBJECT: string;
    URL: string;
    OBJECTHOME: string;
    LIST: string;
    SEARCH: string;
    NEW_RECORD_MODAL: string;
    FLOW: string;
  };
  searchAndScreenPop: (params: {
    searchParams: string;
    queryParams?: string;
    params?: Record<string, unknown>; // TODO
    defaultFieldValues?: Record<string, string>;
    deferred?: boolean;
    callback: Callback<CallbackResponses['searchAndScreenPop']>
    callType: keyof OpenCTI['CALL_TYPE'] | string
  }) => void;
  CALL_TYPE: {
    INBOUND: string;
    OUTBOUND: string;
    INTERNAL: string;
  };
}

interface Salesforce {
  opencti: OpenCTI;
}

export declare global {
  const sforce: Salesforce;

  interface Window {
    sforce: Salesforce;
  }
}
