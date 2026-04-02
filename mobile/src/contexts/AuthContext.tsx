import React, { createContext, useContext, useState, useEffect, ReactNode } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { api } from '../api/client';
import { getPushToken, savePushToken, setupNotificationListeners } from '../services/pushNotifications';
import type { SessionUser } from '../types';

interface AuthContextType {
  token: string | null;
  userId: string | null;
  user: SessionUser | null;
  login: (token: string, user: SessionUser) => void;
  logout: () => void;
  loading: boolean;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

export const useAuth = () => {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return context;
};

interface AuthProviderProps {
  children: ReactNode;
}

export const AuthProvider: React.FC<AuthProviderProps> = ({ children }) => {
  const [token, setToken] = useState<string | null>(null);
  const [userId, setUserId] = useState<string | null>(null);
  const [user, setUser] = useState<SessionUser | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const loadAuth = async () => {
      try {
        const storedToken = await AsyncStorage.getItem('pm_token');
        const storedUserId = await AsyncStorage.getItem('pm_user_id');
        const storedEmail = await AsyncStorage.getItem('pm_email');
        if (storedToken && storedUserId && storedEmail) {
          setToken(storedToken);
          setUserId(storedUserId);
          setUser({ id: storedUserId, email: storedEmail, username: storedEmail.split('@')[0] });
        }
      } catch (error) {
        console.error('Failed to load auth data', error);
      } finally {
        setLoading(false);
      }
    };
    loadAuth();

    // Настроить listeners для входящих уведомлений
    const unsubscribe = setupNotificationListeners();
    return unsubscribe;
  }, []);

  const login = async (newToken: string, newUser: SessionUser) => {
    setToken(newToken);
    setUserId(newUser.id);
    setUser(newUser);
    await AsyncStorage.setItem('pm_token', newToken);
    await AsyncStorage.setItem('pm_user_id', newUser.id);
    await AsyncStorage.setItem('pm_email', newUser.email);

    // Получить и отправить push-токен (с логированием)
    try {
      console.log('=== Starting push token setup ===');
      const pushToken = await getPushToken(newToken);
      if (pushToken) {
        console.log('→ Push token received, saving to server...');
        const saved = await savePushToken(newToken, pushToken);
        if (saved) {
          console.log('✅ Push token successfully saved!');
        } else {
          console.log('⚠️ Failed to save push token to server');
        }
      } else {
        console.log('⚠️ No push token obtained');
      }
    } catch (err) {
      console.error('Error during push token setup:', err);
    }
  };

  const logout = async () => {
    setToken(null);
    setUserId(null);
    setUser(null);
    await AsyncStorage.multiRemove(['pm_token', 'pm_user_id', 'pm_email']);
  };

  return (
    <AuthContext.Provider value={{ token, userId, user, login, logout, loading }}>
      {children}
    </AuthContext.Provider>
  );
};