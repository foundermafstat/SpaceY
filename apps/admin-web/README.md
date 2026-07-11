# SpaceY Admin Web

Private Next.js administration UI. The browser uses only same-origin `/internal/admin/v1` routes; production Nginx sends that prefix directly to `admin-api`. The restricted Next.js relay exists for local/private deployments where both services are separate and requires `ADMIN_API_BASE_URL` plus an exact `ADMIN_WEB_ORIGIN`.

The UI provides primary WebAuthn authentication, server-issued session handling, permission-gated content revisions and audited economy adjustments. CSRF is read from the non-HttpOnly host-only cookie and sent as the double-submit header; backend Origin, CSRF, WebAuthn and RBAC checks remain authoritative.

Current private-API gaps are intentionally not emulated:

- no session revoke/logout endpoint;
- no content revision read/history endpoint;
- no dedicated rollback endpoint.

Until those operations are added to `specs/admin-private.openapi.yaml` and implemented in `admin-api`, the UI exposes no fake logout or rollback action.
