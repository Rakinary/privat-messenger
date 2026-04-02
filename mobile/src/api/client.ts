import axios from 'axios';

// API URL - uses environment variable if set, otherwise defaults to remote tunnel
export const API_URL = process.env.API_URL || 'https://sic-their-personnel-upcoming.trycloudflare.com';

export const api = axios.create({
  baseURL: API_URL,
  headers: {
    'Content-Type': 'application/json',
  },
  timeout: 15000,
});
