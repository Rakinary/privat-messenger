import * as Device from 'expo-device';
import * as Notifications from 'expo-notifications';
import { api } from '../api/client';

Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowAlert: true,
    shouldPlaySound: true,
    shouldSetBadge: true,
    shouldShowBanner: true,
    shouldShowList: true,
  }),
});

export const getPushToken = async (token: string): Promise<string | null> => {
  try {
    console.log('Checking if device is valid for notifications...');
    console.log('Device.isDevice:', Device.isDevice);

    const { status: existingStatus } = await Notifications.getPermissionsAsync();
    console.log('Existing permission status:', existingStatus);
    let finalStatus = existingStatus;

    if (existingStatus !== 'granted') {
      console.log('Requesting notification permissions...');
      const { status } = await Notifications.requestPermissionsAsync();
      console.log('Permission request result:', status);
      finalStatus = status;
    }

    if (finalStatus !== 'granted') {
      console.log('Failed to get push notification permission! Status:', finalStatus);
      return null;
    }

    console.log('Getting Expo push token...');
    const response = await Notifications.getExpoPushTokenAsync({
      projectId: '2e76d6ce-3f45-4771-a64e-e67e58f68646',
    });
    
    const pushToken = response?.data || response;
    
    if (!pushToken || typeof pushToken !== 'string') {
      console.error('Push token is empty or invalid!', { response, pushToken });
      return null;
    }
    
    console.log('✅ Push token obtained:', pushToken);
    return pushToken;
  } catch (err: any) {
    console.error('Error getting push token:');
    console.error('  Message:', err?.message);
    console.error('  Code:', err?.code);
    console.error('  Full error:', JSON.stringify(err, null, 2));
    return null;
  }
};

export const savePushToken = async (token: string, expoPushToken: string): Promise<boolean> => {
  try {
    console.log('📤 Sending push token to server...');
    console.log('   Token:', expoPushToken?.substring(0, 30) + '...');
    
    const response = await api.post(
      '/users/push-token',
      { expoPushToken },
      { headers: { Authorization: `Bearer ${token}` } },
    );
    
    console.log('✅ Push token saved successfully');
    console.log('   Response:', response.data);
    return true;
  } catch (err: any) {
    console.error('❌ Error saving push token:');
    console.error('   Message:', err?.message);
    console.error('   Status:', err?.response?.status);
    console.error('   Data:', err?.response?.data);
    console.error('   Full error:', JSON.stringify(err?.response?.data || err, null, 2));
    return false;
  }
};

export const setupNotificationListeners = () => {
  const notificationListener = Notifications.addNotificationReceivedListener((notification) => {
    console.log('Notification received:', notification);
  });

  const responseListener = Notifications.addNotificationResponseReceivedListener((response) => {
    console.log('Notification response:', response.notification.request.content.data);
  });

  return () => {
    notificationListener.remove();
    responseListener.remove();
  };
};
