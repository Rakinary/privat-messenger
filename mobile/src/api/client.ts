import axios from 'axios';

// Expo exposes only EXPO_PUBLIC_* variables in runtime for the app.
export const API_URL =
  process.env.EXPO_PUBLIC_API_URL ||
  process.env.API_URL ||
  'https://sic-their-personnel-upcoming.trycloudflare.com';

export const api = axios.create({
  baseURL: API_URL,
  headers: {
    'Content-Type': 'application/json',
  },
  timeout: 15000,
});
