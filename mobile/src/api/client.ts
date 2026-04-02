import axios from 'axios';

// Replace with your current Cloudflare Tunnel / ngrok URL when it changes.
export const API_URL = 'https://sic-their-personnel-upcoming.trycloudflare.com';

export const api = axios.create({
  baseURL: API_URL,
  headers: {
    'Content-Type': 'application/json',
  },
  timeout: 15000,
});
