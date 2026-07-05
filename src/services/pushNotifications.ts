import { getNotificationContent, NotificationKey } from '../i18n/notifications';

const EXPO_PUSH_URL = 'https://exp.host/--/api/v2/push/send';

export interface NotificationData {
  type: 'booking' | 'booking_request' | 'contract' | 'society';
  id: string;
}

export async function sendPushNotification(
  expoPushToken: string,
  title: string,
  body: string,
  data?: NotificationData,
): Promise<void> {
  if (!expoPushToken || !expoPushToken.startsWith('ExponentPushToken[')) return;
  try {
    await fetch(EXPO_PUSH_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Accept: 'application/json',
      },
      body: JSON.stringify({
        to: expoPushToken,
        title,
        body,
        data,
        sound: 'default',
        channelId: 'kamon',
        priority: 'high',
      }),
    });
  } catch (e) {
    // Log but never throw — notification failure must not break the main operation
    console.error('[Push] Failed to send notification:', e);
  }
}

// Preferred entry point for all new/updated call sites: resolves the recipient's language via
// the backend notification i18n module, then delegates to the raw sender above. Never awaited
// by callers (matches the existing fire-and-forget style) — a push send must never hold up the
// booking/contract mutation that triggered it.
export async function sendLocalizedNotification(
  expoPushToken: string | null | undefined,
  locale: string | null | undefined,
  key: NotificationKey,
  params: Record<string, string | number> = {},
  data?: NotificationData,
): Promise<void> {
  if (!expoPushToken) return;
  const { title, body } = getNotificationContent(key, locale, params);
  await sendPushNotification(expoPushToken, title, body, data);
}
