export default {
  routes: [
    { method: 'POST', path: '/auth/register-company', handler: 'auth.registerCompany', config: { policies: [], auth: false } },
    { method: 'POST', path: '/auth/login', handler: 'auth.login', config: { policies: [], auth: false } },
    { method: 'POST', path: '/auth/pin-login', handler: 'auth.pinLogin', config: { policies: [], auth: false } },
    { method: 'GET', path: '/auth/me', handler: 'auth.me', config: { policies: [], auth: false } },
  ],
};
