import React, { useEffect } from 'react';
import { NavigationContainer } from '@react-navigation/native';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { Platform, UIManager } from 'react-native';
import { AuthProvider, useAuth } from './src/contexts/AuthContext';
import LoginScreen from './src/screens/LoginScreen';
import ChatsScreen from './src/screens/ChatsScreen';
import ChatScreen from './src/screens/ChatScreen';
import UserProfileScreen from './src/screens/UserProfileScreen';
import GroupProfileScreen from './src/screens/GroupProfileScreen';
import type { RootStackParamList } from './src/types';

const Stack = createNativeStackNavigator<RootStackParamList>();

function AppNavigator() {
  const { token, login, loading } = useAuth();

  useEffect(() => {
    if (Platform.OS === 'android' && UIManager.setLayoutAnimationEnabledExperimental) {
      UIManager.setLayoutAnimationEnabledExperimental(true);
    }
  }, []);

  if (loading) {
    return null; // Или спиннер
  }

  return (
    <Stack.Navigator
      screenOptions={{
        headerShown: false,
        animation: 'fade_from_bottom',
        animationDuration: 220,
      }}
    >
      {!token ? (
        <Stack.Screen name="Login">
          {() => <LoginScreen onLogin={login} />}
        </Stack.Screen>
      ) : (
        <>
          <Stack.Screen name="Chats" component={ChatsScreen} />
          <Stack.Screen
            name="Chat"
            component={ChatScreen}
            options={{
              animation: 'slide_from_right',
              animationDuration: 250,
            }}
          />
          <Stack.Screen
            name="UserProfile"
            component={UserProfileScreen}
            options={{
              animation: 'slide_from_right',
              animationDuration: 240,
            }}
          />
          <Stack.Screen
            name="GroupProfile"
            component={GroupProfileScreen}
            options={{
              animation: 'slide_from_right',
              animationDuration: 240,
            }}
          />
        </>
      )}
    </Stack.Navigator>
  );
}

export default function App() {
  return (
    <AuthProvider>
      <NavigationContainer>
        <AppNavigator />
      </NavigationContainer>
    </AuthProvider>
  );
}