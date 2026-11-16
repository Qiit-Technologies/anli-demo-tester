export type AnliWebhookPayload = {
  hotelId: number;
  eventType: string;
  event: string;
  timestamp: string;
  data: unknown;
};

export type ReceivedWebhookEvent = {
  id: string;
  receivedAt: string;
  method: string;
  signatureVerified: true;
  payload: AnliWebhookPayload;
};

const MAX_EVENTS = 100;

type EventStoreGlobal = typeof globalThis & {
  __anliDemoWebhookEvents?: ReceivedWebhookEvent[];
};

function getStore(): ReceivedWebhookEvent[] {
  const globalStore = globalThis as EventStoreGlobal;
  globalStore.__anliDemoWebhookEvents ??= [];
  return globalStore.__anliDemoWebhookEvents;
}

export function addWebhookEvent(
  payload: AnliWebhookPayload,
  method: string,
): ReceivedWebhookEvent {
  const event: ReceivedWebhookEvent = {
    id: crypto.randomUUID(),
    receivedAt: new Date().toISOString(),
    method,
    signatureVerified: true,
    payload,
  };

  const events = getStore();
  events.unshift(event);
  events.length = Math.min(events.length, MAX_EVENTS);

  return event;
}

export function listWebhookEvents(): ReceivedWebhookEvent[] {
  return [...getStore()];
}

export function clearWebhookEvents(): void {
  getStore().length = 0;
}
