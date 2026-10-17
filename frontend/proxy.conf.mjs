// Dev-server proxy shared by every app: `/api` goes to the one backend, so
// the browser stays same-origin exactly like in prod (where nginx does this).
// API_TARGET is set by docker-compose.yml; the default suits a backend
// started on the host (`docker compose up backend` publishes it on 8400).
export default {
  '/api': {
    target: process.env.API_TARGET ?? 'http://localhost:8400',
    secure: false,
  },
};
