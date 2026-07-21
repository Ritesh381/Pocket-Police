import Constants from 'expo-constants';
import { supabase } from './supabase';

// Resolve the backend base URL. Priority:
//   1. EXPO_PUBLIC_API_URL (explicit override)
//   2. Auto-detect: the Metro bundler host is your Mac's LAN IP → use it on :4000
//   3. localhost fallback (web / simulator)
function resolveBaseUrl() {
  if (process.env.EXPO_PUBLIC_API_URL) return process.env.EXPO_PUBLIC_API_URL;

  // e.g. "192.168.1.50:8081" or "exp://192.168.1.50:8081"
  const hostUri =
    Constants.expoConfig?.hostUri ||
    Constants.expoGoConfig?.debuggerHost ||
    Constants.manifest2?.extra?.expoGo?.debuggerHost ||
    '';
  const host = hostUri.replace(/^\w+:\/\//, '').split(':')[0];
  if (host) return `http://${host}:4000`;

  return 'http://localhost:4000';
}

export const API_BASE = resolveBaseUrl();

async function authHeader() {
  const { data } = await supabase.auth.getSession();
  const token = data.session?.access_token;
  return token ? { Authorization: `Bearer ${token}` } : {};
}

async function request(method, path, body) {
  const headers = { 'Content-Type': 'application/json', ...(await authHeader()) };
  let res;
  try {
    res = await fetch(`${API_BASE}${path}`, {
      method,
      headers,
      ...(body ? { body: JSON.stringify(body) } : {}),
    });
  } catch (e) {
    throw new Error(
      `Network error reaching ${API_BASE}. Is the backend running and on the same Wi-Fi? (${e.message})`,
    );
  }
  const json = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(json.error || `Request failed (${res.status})`);
  }
  return json;
}

export const api = {
  base: API_BASE,
  getMe: () => request('GET', '/api/me'),
  updateMe: (body) => request('PATCH', '/api/me', body),

  getDashboard: () => request('GET', '/api/dashboard'),

  listPeople: () => request('GET', '/api/people'),
  getPerson: (id) => request('GET', `/api/people/${id}`),
  createPerson: (body) => request('POST', '/api/people', body),
  updatePerson: (id, body) => request('PATCH', `/api/people/${id}`, body),
  deletePerson: (id) => request('DELETE', `/api/people/${id}`),

  listExpenses: (personId) => request('GET', `/api/people/${personId}/expenses`),
  addExpense: (personId, body) => request('POST', `/api/people/${personId}/expenses`, body),
  updateExpense: (id, body) => request('PATCH', `/api/expenses/${id}`, body),
  deleteExpense: (id) => request('DELETE', `/api/expenses/${id}`),

  getSettings: () => request('GET', '/api/settings'),
  updateSettings: (body) => request('PATCH', '/api/settings', body),

  getReminderLogs: () => request('GET', '/api/reminders/logs'),
};
