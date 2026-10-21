export const environment = {
  production: false,
  // Relative so `ng serve` forwards it to the oh-auth-gtwy gateway (localhost:9001) via proxy.conf.json.
  apiUrl: '/api/v1',
  // true signs in against the local built-in / Hostel Owner accounts instead of the backend.
  useMockAuth: false,
};
