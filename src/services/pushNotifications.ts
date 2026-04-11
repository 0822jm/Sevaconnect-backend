const EXPO_PUSH_URL = 'https://exp.host/--/api/v2/push/send';

export async function sendPushNotification(
  expoPushToken: string,
  title: string,
  body: string,
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
        sound: 'default',
        channelId: 'sevaconnect',
        priority: 'high',
      }),
    });
  } catch (e) {
    // Log but never throw — notification failure must not break the main operation
    console.error('[Push] Failed to send notification:', e);
  }
}
